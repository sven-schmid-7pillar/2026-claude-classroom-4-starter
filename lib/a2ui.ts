/**
 * The id of the tutor's A2UI catalog, shared by the server that names it in
 * `createSurface` and the browser that registers it (components/a2ui-catalog.tsx).
 * The chat's renderer knows only the catalog handed to the provider and looks
 * it up by this id, so a mismatch renders "Catalog not found" instead of the
 * card. A plain module so both sides can import it.
 */
export const TUTOR_CATALOG_ID = "ai-tutor://a2ui/catalog/v1";
