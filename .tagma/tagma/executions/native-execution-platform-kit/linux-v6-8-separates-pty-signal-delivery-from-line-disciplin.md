---
id: 01a1a893-53a7-73ab-a1d6-7674dd7fcc6e
title: Linux v6.8 separates PTY signal delivery from line-discipline flushing
ord: 5
tags: ["research"]
fields:
  {
    "source": {
      "name": "Linux v6.8 PTY, TTY ioctl and N_TTY sources",
      "ref": "https://github.com/torvalds/linux/tree/v6.8/drivers/tty"
    }
  }
---
In Linux v6.8, [pty_signal](https://github.com/torvalds/linux/blob/v6.8/drivers/tty/pty.c) sends a process-group signal but does not perform the input/output flush that N_TTY's ordinary signal-character path performs. [TTY ioctl dispatch](https://github.com/torvalds/linux/blob/v6.8/drivers/tty/tty_io.c) flushes the receiving flip buffer for TCIFLUSH or TCIOFLUSH before the line discipline handles it. [N_TTY polling](https://github.com/torvalds/linux/blob/v6.8/drivers/tty/n_tty.c) can drain pending flip-buffer work before declaring an empty read queue. These are source observations, not runtime proof of this project's interrupt implementation; full-buffer signal, flush and echo behavior still require the integration lanes.