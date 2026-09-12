import { errorResponse } from "../lib/http.js";

export function handleTwinImpact() {
  return errorResponse(503, "public Twin impact projection is unavailable");
}
