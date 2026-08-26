# Pending OTHMODE Task imports

OTHMODE Task Reports normally reach the store live (API or CLI). When an
othmode-activated command runs in an environment that cannot reach OTHMODE
at all (e.g. Claude Code remote with a network policy that blocks
`*.mythosprod.xyz`), the contract still requires a persistent record — so
the full report is written here as JSON and imported on the host:

```
node projects/command-center/cli/othmode-cli.js task import \
  projects/command-center/data/pending-task-imports/<file>.json
```

The store assigns the task id on import (any id in the file is ignored).
After a successful import, delete the JSON file in the same commit that
records the import — this directory should normally be empty.

These files pass through the same secret gate rules as live writes: never
put credentials in them.
