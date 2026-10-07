#import "MacBridge.h"
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

// These functions run in Xtranslate itself, so its Accessibility permission
// authorizes the paste. Clipboard and target state belong to one serialized paste.
static AXUIElementRef targetWindow = NULL;
static AXUIElementRef targetElement = NULL;
static pid_t targetPID = 0;
static NSArray<NSPasteboardItem *> *savedClipboard;
static NSInteger writtenChangeCount = -1;

int xt_capture_target(void) {
    @autoreleasepool {
        if (targetWindow) { CFRelease(targetWindow); targetWindow = NULL; }
        if (targetElement) { CFRelease(targetElement); targetElement = NULL; }
        NSRunningApplication *front = NSWorkspace.sharedWorkspace.frontmostApplication;
        targetPID = front && front.processIdentifier != getpid() ? front.processIdentifier : 0;
        if (targetPID && AXIsProcessTrusted()) {
            AXUIElementRef application = AXUIElementCreateApplication(targetPID);
            AXUIElementSetMessagingTimeout(application, 0.2);
            AXUIElementCopyAttributeValue(application, kAXFocusedWindowAttribute, (CFTypeRef *)&targetWindow);
            AXUIElementCopyAttributeValue(application, kAXFocusedUIElementAttribute, (CFTypeRef *)&targetElement);
            if (targetWindow) AXUIElementSetMessagingTimeout(targetWindow, 0.2);
            if (targetElement) AXUIElementSetMessagingTimeout(targetElement, 0.2);
            CFRelease(application);
        }
        return targetPID;
    }
}

bool xt_activate_target(int pid) {
    @autoreleasepool {
        if (pid <= 0 || pid != targetPID) return false;
        NSRunningApplication *application = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
        if (!application || application.terminated) return false;
        bool accepted = [application activateWithOptions:NSApplicationActivateIgnoringOtherApps];
        if (targetWindow) {
            AXUIElementPerformAction(targetWindow, kAXRaiseAction);
            AXUIElementSetAttributeValue(targetWindow, kAXMainAttribute, kCFBooleanTrue);
        }
        // Activating an application does not necessarily restore its input field.
        // Keep the exact element captured before the translator took focus.
        if (targetElement) AXUIElementSetAttributeValue(targetElement, kAXFocusedAttribute, kCFBooleanTrue);
        return accepted;
    }
}

bool xt_target_is_frontmost(int pid) {
    @autoreleasepool {
        if (pid <= 0 || pid != targetPID || NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier != pid) return false;
        if (!targetWindow) return true;
        AXUIElementRef application = AXUIElementCreateApplication(pid);
        AXUIElementSetMessagingTimeout(application, 0.2);
        CFTypeRef focused = NULL;
        AXError error = AXUIElementCopyAttributeValue(application, kAXFocusedWindowAttribute, &focused);
        bool same = error == kAXErrorSuccess && focused && CFEqual(focused, targetWindow);
        if (focused) CFRelease(focused);
        CFRelease(application);
        return same;
    }
}

bool xt_modifiers_released(void) {
    CGEventFlags flags = CGEventSourceFlagsState(kCGEventSourceStateCombinedSessionState);
    return !(flags & (kCGEventFlagMaskCommand | kCGEventFlagMaskAlternate | kCGEventFlagMaskControl | kCGEventFlagMaskShift)) &&
        !CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, 36) &&
        !CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, 76);
}

bool xt_can_post_events(void) {
    return AXIsProcessTrusted() && CGPreflightPostEventAccess();
}

bool xt_target_is_ready(int pid) {
    if (!xt_target_is_frontmost(pid)) return false;
    if (!targetElement) return true; // Some applications do not expose their editor.
    AXUIElementRef application = AXUIElementCreateApplication(pid);
    AXUIElementSetMessagingTimeout(application, 0.2);
    CFTypeRef focused = NULL;
    AXError error = AXUIElementCopyAttributeValue(application, kAXFocusedUIElementAttribute, &focused);
    bool same = error == kAXErrorSuccess && focused && CFEqual(focused, targetElement);
    if (focused) CFRelease(focused);
    CFRelease(application);
    return same;
}

bool xt_paste(int pid) {
    // Recheck immediately before posting, after the asynchronous focus wait.
    if (!xt_can_post_events() || !xt_target_is_ready(pid) || !xt_modifiers_released() || !xt_clipboard_is_current()) return false;
    CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStatePrivate);
    if (!source) return false;
    CGEventRef down = CGEventCreateKeyboardEvent(source, 9, true);
    CGEventRef up = CGEventCreateKeyboardEvent(source, 9, false);
    if (down && up) {
        CGEventSetFlags(down, kCGEventFlagMaskCommand);
        CGEventSetFlags(up, kCGEventFlagMaskCommand);
        // Send only to the captured application. A global HID event can be
        // consumed by the translator or a different app during activation.
        CGEventPostToPid(pid, down);
        CGEventPostToPid(pid, up);
    }
    bool sent = down && up;
    if (down) CFRelease(down);
    if (up) CFRelease(up);
    CFRelease(source);
    return sent;
}

bool xt_caret_rect(int pid, double *rect) {
    if (pid <= 0 || !rect || !AXIsProcessTrusted()) return false;
    AXUIElementRef application = AXUIElementCreateApplication(pid);
    AXUIElementSetMessagingTimeout(application, 0.2);
    CFTypeRef element = NULL, range = NULL, bounds = NULL;
    bool ok = false;
    if (AXUIElementCopyAttributeValue(application, kAXFocusedUIElementAttribute, &element) == kAXErrorSuccess && element &&
        AXUIElementCopyAttributeValue((AXUIElementRef)element, kAXSelectedTextRangeAttribute, &range) == kAXErrorSuccess && range &&
        AXUIElementCopyParameterizedAttributeValue((AXUIElementRef)element, kAXBoundsForRangeParameterizedAttribute, range, &bounds) == kAXErrorSuccess && bounds &&
        CFGetTypeID(bounds) == AXValueGetTypeID()) {
        CGRect r;
        if (AXValueGetValue((AXValueRef)bounds, kAXValueCGRectType, &r) && r.size.height > 0) {
            rect[0] = r.origin.x; rect[1] = r.origin.y;
            rect[2] = r.size.width; rect[3] = r.size.height;
            ok = true;
        }
    }
    if (bounds) CFRelease(bounds);
    if (range) CFRelease(range);
    if (element) CFRelease(element);
    CFRelease(application);
    return ok;
}

void xt_save_clipboard(void) {
    @autoreleasepool {
        NSMutableArray *items = [NSMutableArray array];
        for (NSPasteboardItem *original in NSPasteboard.generalPasteboard.pasteboardItems) {
            NSPasteboardItem *copy = [[NSPasteboardItem alloc] init];
            for (NSPasteboardType type in original.types) {
                NSData *data = [original dataForType:type];
                if (data) [copy setData:data forType:type];
            }
            [items addObject:copy];
        }
        savedClipboard = [items copy];
        writtenChangeCount = -1;
    }
}

bool xt_write_text(NSString *text) {
    @autoreleasepool {
        NSPasteboard *clipboard = NSPasteboard.generalPasteboard;
        [clipboard clearContents];
        bool written = [clipboard setString:text forType:NSPasteboardTypeString];
        writtenChangeCount = written ? clipboard.changeCount : -1;
        return written;
    }
}

bool xt_clipboard_is_current(void) {
    return writtenChangeCount >= 0 && writtenChangeCount == NSPasteboard.generalPasteboard.changeCount;
}

void xt_finish_clipboard(bool restore) {
    @autoreleasepool {
        NSPasteboard *clipboard = NSPasteboard.generalPasteboard;
        if (restore && savedClipboard && writtenChangeCount == clipboard.changeCount) {
            [clipboard clearContents];
            if (savedClipboard.count) [clipboard writeObjects:savedClipboard];
        }
        savedClipboard = nil;
        writtenChangeCount = -1;
    }
}
