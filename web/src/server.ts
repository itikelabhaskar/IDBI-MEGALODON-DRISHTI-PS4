// Server entry for TanStack Start SSR. Nitro wraps this into the deployable
// server build (node-server preset by default → Docker on ECS).
//
// The server-rendered page carries ~1.2 MB of dehydrated loader data; gzip
// makes it ≈9× smaller for the Bank's SSM path (see server/gzip.ts).
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { gzipIfAccepted } from "../server/gzip";

export default createServerEntry({
  async fetch(...args: Parameters<typeof handler.fetch>) {
    return gzipIfAccepted(args[0], await handler.fetch(...args), /text\/html/);
  },
});
