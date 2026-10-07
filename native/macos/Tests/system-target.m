#import <AppKit/AppKit.h>

@interface SystemTestEditor : NSObject <NSApplicationDelegate>
@property NSWindow *window;
@property NSTextView *text;
@property NSTextView *other;
@property NSString *resultPath;
@end

@implementation SystemTestEditor
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    NSMenu *menu = [NSMenu new];
    NSMenuItem *edit = [[NSMenuItem alloc] initWithTitle:@"Edit" action:nil keyEquivalent:@""];
    NSMenu *submenu = [[NSMenu alloc] initWithTitle:@"Edit"];
    [submenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
    edit.submenu = submenu;
    [menu addItem:edit];
    NSApp.mainMenu = menu;
    self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(200, 200, 450, 220)
        styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
    self.window.title = @"Xtranslate 独立测试输入框";
    self.text = [[NSTextView alloc] initWithFrame:NSMakeRect(0,110,450,110)];
    self.text.richText = NO;
    [self.window.contentView addSubview:self.text];
    self.other = [[NSTextView alloc] initWithFrame:NSMakeRect(0,0,450,110)];
    self.other.richText = NO;
    [self.window.contentView addSubview:self.other];
    [self.window makeKeyAndOrderFront:nil];
    [self.window makeFirstResponder:self.text];
    [NSApp activateIgnoringOtherApps:YES];
    [NSTimer scheduledTimerWithTimeInterval:0.05 repeats:YES block:^(NSTimer *timer) {
        NSString *switchPath = [self.resultPath stringByAppendingString:@".switch"];
        if ([NSFileManager.defaultManager fileExistsAtPath:switchPath]) {
            [NSFileManager.defaultManager removeItemAtPath:switchPath error:nil];
            [self.window makeFirstResponder:self.other];
        }
        if (self.text.string.length) {
            [self.text.string writeToFile:self.resultPath atomically:YES encoding:NSUTF8StringEncoding error:nil];
            [self.other.string writeToFile:[self.resultPath stringByAppendingString:@".secondary"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
            [timer invalidate];
        }
    }];
}
@end

int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc != 2) return 2;
        NSApplication *app = NSApplication.sharedApplication;
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        SystemTestEditor *delegate = [SystemTestEditor new];
        delegate.resultPath = [NSString stringWithUTF8String:argv[1]];
        app.delegate = delegate;
        [app run];
    }
}
