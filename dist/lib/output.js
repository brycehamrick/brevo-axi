/**
 * Output helpers shared by commands: the --json escape hatch and definitive
 * empty states (AXI principles 1 and 5).
 */
import { compact } from "./coerce.js";
export function renderResult(output, json) {
    if (json) {
        return JSON.stringify(output, null, 2);
    }
    return compact(output);
}
/** Build the definitive empty-state marker for a list command. */
export function emptyState(emptyMessage) {
    return { result: emptyMessage };
}
export function pageCountLine(shown, total, flag) {
    if (total === undefined || shown >= total)
        return undefined;
    return `showing ${shown} of ${total} \u2014 pass --${flag} or a larger --limit to see more`;
}
