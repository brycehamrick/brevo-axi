import { AxiError } from "axi-sdk-js";
/** Fail fast with actionable guidance when BREVO_API_KEY is not exported. */
export function requireApiKey(ctx, commandPath) {
    if (ctx.config.apiKey === undefined) {
        throw new AxiError(`${commandPath} requires BREVO_API_KEY`, "AUTH_REQUIRED", [
            "Generate a v3 API key at Brevo > SMTP & API > API Keys",
            "https://app.brevo.com/settings/keys/api",
            "Export it: export BREVO_API_KEY=xkeysib-...",
        ]);
    }
}
