/**
 * ny-time.mjs
 *
 * Converts a zone-less "YYYY-MM-DDTHH:MM:SS.mmm" string — the format Stage 1
 * emits for Citi Bike started_at/ended_at — into an epoch-ms Number, treating
 * the string as America/New_York wall-clock time REGARDLESS of the host
 * machine's timezone.
 *
 * Every ETL stage that turns these strings into epochs (Stage 2, Stage 4)
 * must go through this function instead of `new Date(str).getTime()`, which
 * parses zone-less ISO strings in the host's local timezone. That made the
 * pipeline correct only by accident on an America/New_York machine and wrong
 * by exactly the UTC offset (4-5h) on a CI runner or any other host.
 */

// UTC offset (ms) of America/New_York at a given UTC instant, e.g. -4h
// during EDT, -5h during EST. Looking up the offset from an instant that is
// itself only approximate (see below) is safe because DST transitions are
// hours away from any given wall-clock time except in the one-hour window of
// the transition itself.
function nyOffsetMsAt(utcMs) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs)).reduce((acc, p) => ((acc[p.type] = p.value), acc), {});

    const asIfUTC = Date.UTC(
        Number(parts.year), Number(parts.month) - 1, Number(parts.day),
        parts.hour === '24' ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second)
    );
    return asIfUTC - utcMs;
}

export function nyWallClockToEpochMs(isoStr) {
    // Parsing the zone-less string as if it carried a "Z" suffix gives an
    // instant offset from the true one by exactly the NY UTC offset — close
    // enough to resolve which side of the EDT/EST boundary it falls on.
    const approxUtcMs = Date.parse(`${isoStr}Z`);
    if (Number.isNaN(approxUtcMs)) {
        throw new Error(`nyWallClockToEpochMs: unparseable timestamp "${isoStr}"`);
    }
    return approxUtcMs - nyOffsetMsAt(approxUtcMs);
}
