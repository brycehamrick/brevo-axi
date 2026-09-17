/**
 * Narrowing helpers shared by every command. All Brevo payloads flow through
 * these so unknown shapes degrade to omitted fields instead of crashes.
 */
export function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function asRecord(value) {
    return isRecord(value) ? value : undefined;
}
export function asString(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
export function asNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
export function asBoolean(value) {
    return typeof value === "boolean" ? value : undefined;
}
export function asStringArray(value) {
    if (!Array.isArray(value))
        return undefined;
    return value.filter((item) => typeof item === "string" && item.length > 0);
}
export function asNumberArray(value) {
    if (!Array.isArray(value))
        return undefined;
    return value.filter((item) => typeof item === "number" && Number.isFinite(item));
}
export function asRecordArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((row) => isRecord(row));
}
/** Drop undefined values from a record so TOON output stays clean. */
export function compact(record) {
    const out = {};
    for (const [key, value] of Object.entries(record)) {
        if (value !== undefined)
            out[key] = value;
    }
    return out;
}
