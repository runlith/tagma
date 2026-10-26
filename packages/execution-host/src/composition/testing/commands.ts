import type { Scenario, Command } from '../../holder/testing/Adapter';
import type { LaunchTransport } from '@runlith/executions/protocol/launch';

export const command = (scenario: Scenario, transport: LaunchTransport, size = 96 * 1024): Command => {
  const terminal = transport._tag === 'pty';
  const raw = terminal ? 'system("/bin/stty","raw","-echo")==0 or die "stty"; ' : '';
  const start = '$|=1; alarm 12; ';
  const echo = `my $left=${size}; while($left){ my $n=sysread(STDIN,my $b,$left>4096?4096:$left); die "read" unless $n; print $b; $left-=$n; }`;
  const script = (): string => {
    switch (scenario) {
      case 'geometry':
        return `${start}system("/bin/stty","size"); print "READY\\n"; sysread(STDIN,my $b,1);`;
      case 'echo':
        return `${start}${raw}print "READY\\n"; ${echo}`;
      case 'cat':
        return `${start}print "READY\\n"; while(my $n=sysread(STDIN,my $b,4096)){print $b;} print "DONE\\n";`;
      case 'output':
        return `${start}${raw}print "READY\\n"; sysread(STDIN,my $go,1); print "y\\n" x (${size}/2);`;
      case 'alternate':
        return `${start}${raw}print "\\e[2J\\e[HMAIN\\e[?1049h\\e[HALT\\n"; sysread(STDIN,my $go,1); print "\\e[?1049l";`;
      case 'resize':
        return `${start}system("/bin/stty","raw","-echo"); $SIG{WINCH}=sub { system("/bin/stty","size"); print "WINCH\\n"; }; print "READY\\n"; while(1){sysread(STDIN,my $b,1);}`;
      case 'no-isig':
        return `${start}system("/bin/stty","raw","-echo"); print "READY\\n"; ${echo}`;
      case 'foreground':
        return `${start}exec "/bin/bash","--noprofile","--norc","--noediting","-i","+o","history";`;
      case 'orphan-input':
        return `${start}${raw}$SIG{HUP}="IGNORE"; if(fork()){exit 7}; ${echo}`;
      case 'orphan-terminal':
        return `${start}${raw}$SIG{HUP}="IGNORE"; if(my $pid=fork()){print "$pid\\n"; sysread(STDIN,my $go,1); exit 7;} sleep 12;`;
      case 'closed-input':
        return `${start}close STDIN; print "READY\\n"; sleep 12;`;
      case 'split-output':
        return `${start}print STDOUT "O" x ${size}; print STDERR "E" x ${size}; exit 3;`;
      case 'flood':
        return `${start}${raw}print "READY\\n"; while(1){print "x" x 4096;}`;
      case 'wait':
        return `${start}${raw}print "READY\\n"; sysread(STDIN,my $go,1); exit 37;`;
      case 'fork':
        return `${start}$SIG{HUP}="IGNORE"; if(my $pid=fork()){ $SIG{TERM}=sub{exit 7}; print "$pid\\n"; sysread(STDIN,my $go,1); exit 7; } sleep 12;`;
      case 'interrupt':
        return `${start}my $pid=fork(); if(!$pid){ $SIG{INT}=sub{print "CLEANED\\n"; exit 0}; print "READY\\n"; sleep 12; exit 0; } $SIG{INT}="IGNORE"; waitpid($pid,0); exit 0;`;
      case 'terminate':
        return `${start}$SIG{INT}="IGNORE"; $SIG{TERM}=sub{print "TERMINATED\\n"; exit 0}; print "READY\\n"; sleep 12;`;
      case 'stubborn':
        return `${start}$SIG{INT}="IGNORE"; $SIG{TERM}="IGNORE"; print "READY\\n"; sleep 12;`;
      case 'handles':
        return `${start}use POSIX; opendir(my $d,"/dev/fd") or die "fds"; my @fds=grep { /^\\d+$/ && $_>2 } readdir($d); closedir($d); for my $fd (@fds){ my @stat=POSIX::fstat($fd); print "$fd\\n" if @stat; }`;
      case 'limits':
        return `${start}exec "/bin/sh","-c","ulimit -n; ulimit -u";`;
      case 'cost':
        return `${start}print "READY\\n"; sysread(STDIN,my $go,1); my $n=0; $n+=sin($_) for 1..3000000; print "DONE\\n";`;
    }
  };
  return { path: '/usr/bin/perl', args: ['-e', script()] };
};
