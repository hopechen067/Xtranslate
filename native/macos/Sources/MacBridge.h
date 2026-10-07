#ifndef XTRANSLATE_MAC_BRIDGE_H
#define XTRANSLATE_MAC_BRIDGE_H

#import <Foundation/Foundation.h>
#include <stdbool.h>

int xt_capture_target(void);
bool xt_activate_target(int pid);
bool xt_target_is_frontmost(int pid);
bool xt_target_is_ready(int pid);
bool xt_modifiers_released(void);
bool xt_can_post_events(void);
bool xt_paste(int pid);
bool xt_caret_rect(int pid, double *rect);
void xt_save_clipboard(void);
bool xt_write_text(NSString *text);
bool xt_clipboard_is_current(void);
void xt_finish_clipboard(bool restore);

#endif
