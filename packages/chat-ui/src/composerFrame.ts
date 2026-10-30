export const COMPOSER_FRAME_CLASS =
  '@container relative grid gap-0.5 rounded-lg border border-input bg-chat-field p-1.5 transition duration-150 hover:border-foreground/20 focus-within:border-foreground/30 focus-within:hover:border-foreground/30 data-alert:border-destructive data-alert:ring-2 data-alert:ring-destructive/20 data-alert:hover:border-destructive data-alert:focus-within:border-destructive data-alert:focus-within:ring-destructive/20 data-dropping:border-dashed data-dropping:border-foreground/30 data-aimed:border-chat-aim data-aimed:ring-2 data-aimed:ring-chat-aim/20 data-aimed:hover:border-chat-aim data-aimed:focus-within:border-chat-aim data-aimed:focus-within:hover:border-chat-aim';

export const COMPOSER_INPUT_CLASS =
  'max-h-[min(22vh,10rem)] min-h-10 w-full resize-none overflow-y-auto border-0 bg-transparent px-3 pt-2 pb-1 text-body leading-6 text-foreground caret-foreground outline-none @min-[30rem]:max-h-[min(32vh,16rem)] @min-[30rem]:min-h-11 @min-[30rem]:px-3 @min-[30rem]:pt-2 @min-[30rem]:pb-1';

export const COMPOSER_ACTION_ROW_CLASS =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 border-t border-border/55 px-0.5 pt-1.5 @min-[30rem]:gap-2 @min-[30rem]:border-t-0 @min-[30rem]:pt-0';

export const COMPOSER_ACTION_LEFT_CLASS =
  'flex min-w-0 flex-nowrap items-center gap-0.5 pointer-coarse:overflow-x-auto pointer-coarse:*:shrink-0 @min-[30rem]:gap-1';

export const COMPOSER_ACTION_RIGHT_CLASS = 'flex shrink-0 items-center gap-1 justify-self-end';

export const COMPOSER_ACTION_GROUP_CLASS = 'flex items-center gap-1';

export const COMPOSER_STATUS_GROUP_CLASS = 'hidden items-center gap-1 @min-[22rem]:flex';

export const COMPOSER_STRIP_CLASS = 'flex h-7 min-w-0 items-center gap-2 px-1.5 pt-1';
