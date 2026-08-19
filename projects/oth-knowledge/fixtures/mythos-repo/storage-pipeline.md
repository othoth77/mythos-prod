# Storage pipeline excerpt (synthetic fixture)

All application writes pass through the approved storage write pipeline.
Pending writes must survive temporary failures, tombstones prevent deleted
records from reappearing, and merge behavior is deterministic. Offline
recovery keeps unsynchronized changes safe until connectivity returns.
