/// <reference lib="dom" />
import type { ViewTools } from "./plugin.js";
import type { Component, Snippet } from "svelte";
import type { HTMLAnchorAttributes, HTMLAttributes, HTMLButtonAttributes, HTMLInputAttributes, HTMLTextareaAttributes } from "svelte/elements";

export type TagmaView<Plugin = unknown> = Omit<{
  readonly projectId: number;
  readonly plugin: string;
  readonly view: string;
  readonly threadId: string | null;
  readonly key: string | null;
} & {
  readonly [key: string]: unknown;
  readonly tools: Readonly<Record<string, (input?: Readonly<Record<string, unknown>>) => Promise<unknown>>>;
  readonly storage: ViewStorage;
  readonly theme: {
    readonly id: string;
    readonly mode: "dark" | "light";
    readonly terminal: {
      black: string;
      red: string;
      green: string;
      yellow: string;
      blue: string;
      magenta: string;
      cyan: string;
      white: string;
      brightBlack: string;
      brightRed: string;
      brightGreen: string;
      brightYellow: string;
      brightBlue: string;
      brightMagenta: string;
      brightCyan: string;
      brightWhite: string;
    } & {
      readonly background: string;
      readonly foreground: string;
      readonly cursor: string;
      readonly cursorAccent: string;
      readonly selectionBackground: string;
    };
  };
  resource: (uri: string) => Reading<unknown>;
  thread: (threadId: string) => Reading<{
    readonly threadId: string;
    readonly life: "awaiting" | "idle" | "stalled" | "working";
    readonly runId: string | null;
    readonly text: string | null;
    readonly ended: string | null;
  } | {
    readonly threadId: string;
    readonly missing: "deleted" | "foreign-project" | "not-found";
  } | null>;
  transcript: (threadId: string) => Transcript;
  open: (opening: ViewOpening) => Promise<void>;
  openLink: (url: string) => void;
}, "tools"> & {
  readonly tools: unknown extends Plugin ? Readonly<Record<string, (input?: Readonly<Record<string, unknown>>) => Promise<unknown>>> : ViewTools<Plugin>;
};

export declare const useTagma: <Plugin = unknown>() => TagmaView<Plugin>;

export { TagmaRefused } from "./plugin.js";

export type { ToolFace } from "./plugin.js";

export type Reading<A> = {
  readonly current: A;
  readonly failure: string | null;
};

export type ThreadReading = {
  readonly threadId: string;
  readonly life: "awaiting" | "idle" | "stalled" | "working";
  readonly runId: string | null;
  readonly text: string | null;
  readonly ended: string | null;
} | {
  readonly threadId: string;
  readonly missing: "deleted" | "foreign-project" | "not-found";
};

export type ViewOpening = {
  readonly pane: string;
} | {
  readonly section: string;
} | {
  readonly threadId: string;
  readonly beside?: boolean;
};

export type ViewStorage = {
  get: (key: string) => Promise<{
    readonly stored: boolean;
    readonly value?: unknown;
  }>;
  set: (key: string, value?: unknown) => Promise<boolean>;
};

export type Transcript = {
  readonly entries: ReadonlyArray<{
    runId: string | null;
    id: string;
    role: "assistant" | "notice" | "question" | "tool" | "user";
    text?: string;
    question?: {
      id: string;
      prompts: ReadonlyArray<{
        id: string;
        prompt: string;
        toolCallId: string;
        kind?: string;
        options?: ReadonlyArray<{
          label: string;
          value: string;
          description?: string;
          preview?: string;
        }>;
        header?: string;
        allowMultiple?: boolean;
        allowFreeform?: boolean;
        secret?: boolean;
        approves?: string;
        data?: {
          readonly [key: string]: ReadonlyArray<Json> | boolean | number | string | {
            readonly [key: string]: Json;
          } | null;
        };
      }>;
      answered: boolean;
    };
    tool?: {
      name: string;
      state: "done" | "failed" | "refused" | "running";
      input: unknown;
      output?: unknown;
    };
    sender?: {
      name: string;
      threadId?: string;
    };
  }>;
  readonly tail: ReadonlyArray<{
    runId: string | null;
    id: string;
    role: "assistant" | "notice" | "question" | "tool" | "user";
    text?: string;
    question?: {
      id: string;
      prompts: ReadonlyArray<{
        id: string;
        prompt: string;
        toolCallId: string;
        kind?: string;
        options?: ReadonlyArray<{
          label: string;
          value: string;
          description?: string;
          preview?: string;
        }>;
        header?: string;
        allowMultiple?: boolean;
        allowFreeform?: boolean;
        secret?: boolean;
        approves?: string;
        data?: {
          readonly [key: string]: ReadonlyArray<Json> | boolean | number | string | {
            readonly [key: string]: Json;
          } | null;
        };
      }>;
      answered: boolean;
    };
    tool?: {
      name: string;
      state: "done" | "failed" | "refused" | "running";
      input: unknown;
      output?: unknown;
    };
    sender?: {
      name: string;
      threadId?: string;
    };
  }>;
  readonly more: boolean;
  readonly loaded: boolean;
  readonly failure: string | null;
  older: () => Promise<void>;
};

export declare const Frame: Component<{
  src: string;
  title: string;
  height?: number | null;
  fill?: boolean;
  media?: boolean;
}, {}, "">;

export declare const Button: Component<HTMLButtonAttributes & {
  ref?: HTMLElement | null;
} & HTMLAnchorAttributes & {
  variant?: "confirm" | "default" | "destructive" | "ghost" | "link" | "outline" | "quiet" | "secondary";
  size?: "default" | "icon" | "icon-sm" | "icon-xs" | "sm" | "xs";
}, {}, "ref">;

export declare const Input: Component<(Omit<HTMLInputAttributes, "type"> & {
  type: "file";
  files?: FileList;
} & {
  ref?: HTMLElement | null;
}) | (Omit<HTMLInputAttributes, "type"> & {
  type?: "button" | "checkbox" | "color" | "date" | "datetime-local" | "email" | "hidden" | "image" | "month" | "number" | "password" | "radio" | "range" | "reset" | "search" | "submit" | "tel" | "text" | "time" | "url" | "week" | (string & {});
  files?: undefined;
} & {
  ref?: HTMLElement | null;
}), {}, "files" | "ref" | "value">;

export declare const Textarea: Component<Omit<HTMLTextareaAttributes & {
  ref?: HTMLElement | null;
}, "children">, {}, "ref" | "value">;

export declare const Tooltip: Component<{
  text?: string | null;
  keys?: string | null;
  hints?: ReadonlyArray<{
    readonly keys: string;
    readonly words: string;
  }>;
  side?: "bottom" | "left" | "right" | "top";
  delayMs?: number;
  class?: Array<ClassArray | bigint | boolean | number | string | {
    [key: string]: any;
  } | null | undefined> | string | {
    [key: string]: any;
  };
  style?: string;
  children: Snippet;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children" | "class" | "style">, {}, "">;

export declare const Kbd: Component<{
  chord: string;
  size?: "md" | "sm";
  class?: Array<ClassArray | bigint | boolean | number | string | {
    [key: string]: any;
  } | null | undefined> | string | {
    [key: string]: any;
  };
}, {}, "">;

export declare const FadeText: Component<{
  text?: string;
  children?: Snippet;
  fade?: "end" | "start";
} & Omit<HTMLAttributes<HTMLSpanElement>, "children">, {}, "">;

export declare const PathText: Component<{
  path: string;
  suffix?: string;
  directory?: "after" | "before" | "none";
  nameClass?: string;
  directoryClass?: string;
  onDirectory?: (() => void);
  directoryTitle?: string;
  piece?: Snippet<[from: number, to: number]>;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children">, {}, "">;

export declare const Glyph: Component<{
  class?: string;
  children: Snippet;
}, {}, "">;

export declare const TileMeter: Component<{
  count: number;
  lit: number;
  fill?: string;
  track?: "filled" | "none" | "outlined";
  class?: Array<ClassArray | bigint | boolean | number | string | {
    [key: string]: any;
  } | null | undefined> | string | {
    [key: string]: any;
  };
}, {}, "">;

export declare namespace DropdownMenu {
  const CheckboxItem: Component<(Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclick"> & {
    checked?: boolean;
    indeterminate?: boolean;
    onCheckedChange?: ((checked: boolean) => void);
    disabled?: boolean;
    closeOnSelect?: boolean;
    textValue?: string;
    tail?: Snippet;
    children?: Snippet;
  } & {
    readonly icon: Component<{
      class?: string;
    }>;
    readonly lead?: undefined;
  }) | (Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclick"> & {
    checked?: boolean;
    indeterminate?: boolean;
    onCheckedChange?: ((checked: boolean) => void);
    disabled?: boolean;
    closeOnSelect?: boolean;
    textValue?: string;
    tail?: Snippet;
    children?: Snippet;
  } & {
    readonly icon?: undefined;
    readonly lead?: undefined;
  }) | (Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclick"> & {
    checked?: boolean;
    indeterminate?: boolean;
    onCheckedChange?: ((checked: boolean) => void);
    disabled?: boolean;
    closeOnSelect?: boolean;
    textValue?: string;
    tail?: Snippet;
    children?: Snippet;
  } & {
    readonly lead: Snippet;
    readonly icon?: undefined;
  }), {}, "checked">;
  const Content: Component<HTMLAttributes<HTMLDivElement> & {
    readonly anchor?: HTMLElement | {
      readonly x: number;
      readonly y: number;
    } | {
      rect: () => {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      };
      readonly element: Element;
    };
    readonly returnFocus?: (() => HTMLElement | null) | false;
    readonly dismissOnFocusOutside?: boolean;
    readonly side?: "bottom" | "left" | "right" | "top";
    readonly align?: "center" | "end" | "start";
    readonly sideOffset?: number;
    readonly alignOffset?: number;
    readonly collisionPadding?: number | {
      readonly top?: number;
      readonly right?: number;
      readonly bottom?: number;
      readonly left?: number;
    };
  } & {
    portal?: HTMLElement;
  }, {}, "">;
  const Group: Component<HTMLAttributes<HTMLDivElement>, {}, "">;
  const GroupHeading: Component<Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
    children?: Snippet;
  }, {}, "">;
  const Item: Component<(Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclick"> & {
    readonly closeOnSelect?: boolean;
    readonly onSelect?: ((event: Event) => void);
    readonly disabled?: boolean;
    readonly textValue?: string;
  } & {
    variant?: "default" | "destructive";
    children?: Snippet;
  } & {
    readonly unstyled: true;
    readonly icon?: undefined;
    readonly lead?: undefined;
  } & {} & {
    tail?: undefined;
    hint?: undefined;
    keys?: undefined;
    current?: undefined;
    here?: undefined;
  }) | (Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclick"> & {
    readonly closeOnSelect?: boolean;
    readonly onSelect?: ((event: Event) => void);
    readonly disabled?: boolean;
    readonly textValue?: string;
  } & {
    variant?: "default" | "destructive";
    children?: Snippet;
  } & {
    unstyled?: false;
  } & {
    readonly icon: Component<{
      class?: string;
    }>;
    readonly lead?: undefined;
  } & {
    current?: string | null;
  } & {
    tail?: undefined;
    hint?: undefined;
    keys?: undefined;
    here?: undefined;
  }) | (Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclick"> & {
    readonly closeOnSelect?: boolean;
    readonly onSelect?: ((event: Event) => void);
    readonly disabled?: boolean;
    readonly textValue?: string;
  } & {
    variant?: "default" | "destructive";
    children?: Snippet;
  } & {
    unstyled?: false;
  } & {
    readonly icon: Component<{
      class?: string;
    }>;
    readonly lead?: undefined;
  } & {
    here?: boolean;
  } & {
    tail?: undefined;
    hint?: undefined;
    keys?: undefined;
    current?: undefined;
  }) | (Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclick"> & {
    readonly closeOnSelect?: boolean;
    readonly onSelect?: ((event: Event) => void);
    readonly disabled?: boolean;
    readonly textValue?: string;
  } & {
    variant?: "default" | "destructive";
    children?: Snippet;
  } & {
    unstyled?: false;
  } & {
    readonly icon: Component<{
      class?: string;
    }>;
    readonly lead?: undefined;
  } & {
    hint?: string;
  } & {
    tail?: undefined;
    keys?: undefined;
    current?: undefined;
    here?: undefined;
  }) | (Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclick"> & {
    readonly closeOnSelect?: boolean;
    readonly onSelect?: ((event: Event) => void);
    readonly disabled?: boolean;
    readonly textValue?: string;
  } & {
    variant?: "default" | "destructive";
    children?: Snippet;
  } & {
    unstyled?: false;
  } & {
    readonly icon: Component<{
      class?: string;
    }>;
    readonly lead?: undefined;
  } & {
    keys?: string | null;
  } & {
    tail?: undefined;
    hint?: undefined;
    current?: undefined;
    here?: undefined;
  }) | (Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclick"> & {
    readonly closeOnSelect?: boolean;
    readonly onSelect?: ((event: Event) => void);
    readonly disabled?: boolean;
    readonly textValue?: string;
  } & {
    variant?: "default" | "destructive";
    children?: Snippet;
  } & {
    unstyled?: false;
  } & {
    readonly icon: Component<{
      class?: string;
    }>;
    readonly lead?: undefined;
  } & {
    tail?: Snippet;
  } & {
    hint?: undefined;
    keys?: undefined;
    current?: undefined;
    here?: undefined;
  }) | (Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclick"> & {
    readonly closeOnSelect?: boolean;
    readonly onSelect?: ((event: Event) => void);
    readonly disabled?: boolean;
    readonly textValue?: string;
  } & {
    variant?: "default" | "destructive";
    children?: Snippet;
  } & {
    unstyled?: false;
  } & {
    readonly lead: Snippet;
    readonly icon?: undefined;
  } & {
    current?: string | null;
  } & {
    tail?: undefined;
    hint?: undefined;
    keys?: undefined;
    here?: undefined;
  }) | (Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclick"> & {
    readonly closeOnSelect?: boolean;
    readonly onSelect?: ((event: Event) => void);
    readonly disabled?: boolean;
    readonly textValue?: string;
  } & {
    variant?: "default" | "destructive";
    children?: Snippet;
  } & {
    unstyled?: false;
  } & {
    readonly lead: Snippet;
    readonly icon?: undefined;
  } & {
    here?: boolean;
  } & {
    tail?: undefined;
    hint?: undefined;
    keys?: undefined;
    current?: undefined;
  }) | (Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclick"> & {
    readonly closeOnSelect?: boolean;
    readonly onSelect?: ((event: Event) => void);
    readonly disabled?: boolean;
    readonly textValue?: string;
  } & {
    variant?: "default" | "destructive";
    children?: Snippet;
  } & {
    unstyled?: false;
  } & {
    readonly lead: Snippet;
    readonly icon?: undefined;
  } & {
    hint?: string;
  } & {
    tail?: undefined;
    keys?: undefined;
    current?: undefined;
    here?: undefined;
  }) | (Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclick"> & {
    readonly closeOnSelect?: boolean;
    readonly onSelect?: ((event: Event) => void);
    readonly disabled?: boolean;
    readonly textValue?: string;
  } & {
    variant?: "default" | "destructive";
    children?: Snippet;
  } & {
    unstyled?: false;
  } & {
    readonly lead: Snippet;
    readonly icon?: undefined;
  } & {
    keys?: string | null;
  } & {
    tail?: undefined;
    hint?: undefined;
    current?: undefined;
    here?: undefined;
  }) | (Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclick"> & {
    readonly closeOnSelect?: boolean;
    readonly onSelect?: ((event: Event) => void);
    readonly disabled?: boolean;
    readonly textValue?: string;
  } & {
    variant?: "default" | "destructive";
    children?: Snippet;
  } & {
    unstyled?: false;
  } & {
    readonly lead: Snippet;
    readonly icon?: undefined;
  } & {
    tail?: Snippet;
  } & {
    hint?: undefined;
    keys?: undefined;
    current?: undefined;
    here?: undefined;
  }), {}, "">;
  const Label: Component<Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
    lead?: Snippet;
    children?: Snippet;
  }, {}, "">;
  const Note: Component<Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
    text?: string;
    tone?: "destructive" | "muted";
    children?: Snippet;
  }, {}, "">;
  const RadioGroup: Component<HTMLAttributes<HTMLDivElement> & {
    value?: string;
    onValueChange?: ((value: string) => void);
  }, {}, "value">;
  const RadioItem: Component<(Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclick"> & {
    value: string;
    disabled?: boolean;
    closeOnSelect?: boolean;
    textValue?: string;
    unstyled?: boolean;
    children?: Snippet;
  } & {
    readonly icon: Component<{
      class?: string;
    }>;
    readonly lead?: undefined;
  }) | (Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclick"> & {
    value: string;
    disabled?: boolean;
    closeOnSelect?: boolean;
    textValue?: string;
    unstyled?: boolean;
    children?: Snippet;
  } & {
    readonly icon?: undefined;
    readonly lead?: undefined;
  }) | (Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclick"> & {
    value: string;
    disabled?: boolean;
    closeOnSelect?: boolean;
    textValue?: string;
    unstyled?: boolean;
    children?: Snippet;
  } & {
    readonly lead: Snippet;
    readonly icon?: undefined;
  }), {}, "">;
  const Root: Component<{
    open?: boolean;
    onOpenChange?: ((open: boolean) => void);
    children: Snippet;
  }, {}, "open">;
  const Separator: Component<HTMLAttributes<HTMLDivElement> & {
    unstyled?: boolean;
  }, {}, "">;
  const Sub: Component<{
    open?: boolean;
    onOpenChange?: ((open: boolean) => void);
    children: Snippet;
  }, {}, "open">;
  const SubContent: Component<HTMLAttributes<HTMLDivElement> & {
    readonly side?: "bottom" | "left" | "right" | "top";
    readonly align?: "center" | "end" | "start";
    readonly sideOffset?: number;
    readonly alignOffset?: number;
    readonly collisionPadding?: number | {
      readonly top?: number;
      readonly right?: number;
      readonly bottom?: number;
      readonly left?: number;
    };
  }, {}, "">;
  const SubTrigger: Component<(Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclick"> & {
    disabled?: boolean;
    textValue?: string;
    children?: Snippet;
  } & {
    unstyled: true;
    icon?: undefined;
    lead?: undefined;
    current?: undefined;
  }) | (Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclick"> & {
    disabled?: boolean;
    textValue?: string;
    children?: Snippet;
  } & {
    unstyled?: false;
    current?: string | null;
  } & {
    readonly icon: Component<{
      class?: string;
    }>;
    readonly lead?: undefined;
  }) | (Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclick"> & {
    disabled?: boolean;
    textValue?: string;
    children?: Snippet;
  } & {
    unstyled?: false;
    current?: string | null;
  } & {
    readonly lead: Snippet;
    readonly icon?: undefined;
  }), {}, "">;
  const Trigger: Component<HTMLButtonAttributes, {}, "">;
}

export declare namespace Dialog {
  const Root: Component<{
    open?: boolean;
    interactOutsideBehavior?: "close" | "ignore";
    escapeKeydownBehavior?: "close" | "ignore";
    motion?: {
      overlay?: {
        durationMs?: number;
        easing?: ((t: number) => number);
      };
      content?: {
        variant?: "scale" | "sheet";
        durationMs?: number;
        easing?: ((t: number) => number);
        startScale?: number;
        startOpacity?: number;
        startYpx?: number;
        startXPercent?: number;
        startYPercent?: number;
        startInlinePercent?: number;
      };
    };
    overlayKey?: string;
    announced?: boolean;
    onOpenChange?: ((open: boolean) => void);
    onEscapeIgnored?: (() => void);
    children: Snippet;
  }, {}, "open">;
  const Title: Component<HTMLAttributes<HTMLHeadingElement> & {
    children: Snippet;
  }, {}, "">;
  const Portal: Component<{
    disabled?: boolean;
    target?: HTMLElement;
    children: Snippet;
  }, {}, "">;
  const Footer: Component<HTMLAttributes<HTMLDivElement> & {
    ref?: HTMLElement | null;
  } & {
    showCloseButton?: boolean;
  }, {}, "ref">;
  const Header: Component<HTMLAttributes<HTMLDivElement> & {
    ref?: HTMLElement | null;
  }, {}, "ref">;
  const Trigger: Component<HTMLButtonAttributes & {
    ref?: HTMLButtonElement | null;
    children?: Snippet;
  }, {}, "ref">;
  const Overlay: Component<HTMLAttributes<HTMLDivElement> & {
    ref?: HTMLDivElement | null;
  }, {}, "ref">;
  const Content: Component<HTMLAttributes<HTMLDivElement> & {
    ref?: HTMLDivElement | null;
    children: Snippet;
    motion?: {
      variant?: "scale" | "sheet";
      durationMs?: number;
      easing?: ((t: number) => number);
      startScale?: number;
      startOpacity?: number;
      startYpx?: number;
      startXPercent?: number;
      startYPercent?: number;
      startInlinePercent?: number;
    };
    onCloseComplete?: (() => void);
    onPresent?: (() => void);
    role?: "alertdialog" | "dialog";
  } & {
    portalProps?: {
      disabled?: boolean;
      target?: HTMLElement;
      children: Snippet;
    };
    children: Snippet;
    showCloseButton?: boolean;
  }, {}, "ref">;
  const Description: Component<HTMLAttributes<HTMLParagraphElement> & {
    children: Snippet;
  }, {}, "">;
  const Close: Component<Omit<HTMLButtonAttributes, "onclick"> & {
    onclick?: ((event: MouseEvent) => void);
    child?: Snippet<[{
      props: Record<string, unknown>;
    }]>;
    children?: Snippet;
    dataSlot?: string;
  }, {}, "">;
  const Dialog: Component<{
    open?: boolean;
    interactOutsideBehavior?: "close" | "ignore";
    escapeKeydownBehavior?: "close" | "ignore";
    motion?: {
      overlay?: {
        durationMs?: number;
        easing?: ((t: number) => number);
      };
      content?: {
        variant?: "scale" | "sheet";
        durationMs?: number;
        easing?: ((t: number) => number);
        startScale?: number;
        startOpacity?: number;
        startYpx?: number;
        startXPercent?: number;
        startYPercent?: number;
        startInlinePercent?: number;
      };
    };
    overlayKey?: string;
    announced?: boolean;
    onOpenChange?: ((open: boolean) => void);
    onEscapeIgnored?: (() => void);
    children: Snippet;
  }, {}, "open">;
  const DialogTitle: Component<HTMLAttributes<HTMLHeadingElement> & {
    children: Snippet;
  }, {}, "">;
  const DialogPortal: Component<{
    disabled?: boolean;
    target?: HTMLElement;
    children: Snippet;
  }, {}, "">;
  const DialogFooter: Component<HTMLAttributes<HTMLDivElement> & {
    ref?: HTMLElement | null;
  } & {
    showCloseButton?: boolean;
  }, {}, "ref">;
  const DialogHeader: Component<HTMLAttributes<HTMLDivElement> & {
    ref?: HTMLElement | null;
  }, {}, "ref">;
  const DialogTrigger: Component<HTMLButtonAttributes & {
    ref?: HTMLButtonElement | null;
    children?: Snippet;
  }, {}, "ref">;
  const DialogOverlay: Component<HTMLAttributes<HTMLDivElement> & {
    ref?: HTMLDivElement | null;
  }, {}, "ref">;
  const DialogContent: Component<HTMLAttributes<HTMLDivElement> & {
    ref?: HTMLDivElement | null;
    children: Snippet;
    motion?: {
      variant?: "scale" | "sheet";
      durationMs?: number;
      easing?: ((t: number) => number);
      startScale?: number;
      startOpacity?: number;
      startYpx?: number;
      startXPercent?: number;
      startYPercent?: number;
      startInlinePercent?: number;
    };
    onCloseComplete?: (() => void);
    onPresent?: (() => void);
    role?: "alertdialog" | "dialog";
  } & {
    portalProps?: {
      disabled?: boolean;
      target?: HTMLElement;
      children: Snippet;
    };
    children: Snippet;
    showCloseButton?: boolean;
  }, {}, "ref">;
  const DialogDescription: Component<HTMLAttributes<HTMLParagraphElement> & {
    children: Snippet;
  }, {}, "">;
  const DialogClose: Component<Omit<HTMLButtonAttributes, "onclick"> & {
    onclick?: ((event: MouseEvent) => void);
    child?: Snippet<[{
      props: Record<string, unknown>;
    }]>;
    children?: Snippet;
    dataSlot?: string;
  }, {}, "">;
}

type Json = ReadonlyArray<Json> | boolean | number | string | {
  readonly [key: string]: Json;
} | null;

type ClassArray = Array<ClassArray | bigint | boolean | number | string | {
  [key: string]: any;
} | null | undefined>;
