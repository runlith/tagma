---
id: 01a14e50-38a0-79e0-9c00-1d11320aac40
title: Reading JSON through jq mistakes the filter text for a file path
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "The command successfully returned JSON, but bash attributed \"the files this command printed could not be told apart\" and Unknown: FileSystem.stat with the full text of the jq filter after /opt/workspaces/runlith/; the same false path check and long attribution appeared in the previous jq call.",
    "command": "jq -n --slurpfile s ~/.tagma-dev/scratch/01a14c19-6c7a-788b-a8e4-4b267db89c68/swallowed-sites-before.json --slurpfile p ~/.tagma-dev/scratch/01a14c19-6c7a-788b-a8e4-4b267db89c68/swallowed-sites-enforce.json --slurpfile a ~/.tagma-dev/scratch/01a14c19-6c7a-788b-a8e4-4b267db89c68/swallowed-sites-remap.json 'def key: [.path,.symbol,.form,.site]|join(\"\\u0000\"); $s[0] as $s | $p[0] as $p | $a[0] as $a | $p.inspection.patch[0] as $l | ($s.binding.params.allow|map({key:key,value:.})|from_entries) as $old | ($l.put|map({key:key,value:.})|from_entries) as $put | ($l.drop|map(key)|sort) as $drop | {topKeys:($p|keys),inspectionKeys:($p.inspection|keys),patchKeys:($l|keys),snapshot:[$s.revision,$s.strictness,$s.on,$s.binding.params.base,$s.binding.params.region,$s.binding.params.files],prepared:[$p.blockId,$p.base,$p.strictness],counts:{old:($old|length),puts:($l.put|length),uniquePuts:($put|length),drops:($drop|length),uniqueDrops:($drop|unique|length),mapped:($a.mapping|length),removed:($a.removed|length),merged:$a.merged},invariants:{knownDrops:all($drop[];$old[.]!=null),disjointPutDrop:all($drop[];$put[.]==null),auditPuts:(($l.put|sort_by(key))==($a.allow|sort_by(key))),auditDrops:($drop==($a.drops|map(key)|sort)),oldPartition:(($s.binding.params.allow|sort_by(key))==(([$a.mapping[].old]+$a.removed)|sort_by(key))),mappingToPut:all($a.mapping[];(.old|.site=input_filename) as $unused | . as $m | ($m.old|.site=$m.site) as $next | $put[($next|key)]==$next),exactDrops:($drop==(($old|keys)-($put|keys)|sort))},changed:[$a.mapping[]|select(.old.site!=.site)|{path:.old.path,symbol:.old.symbol,form:.old.form,from:.old.site,to:.site}]}'",
    "expected": "Read-only jq returns a projection of the three explicitly named JSON files; a program filter is not treated as a file path."
  }
---
Filed from project `runlith`.
