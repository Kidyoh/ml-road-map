import type { DefaultSession } from "next-auth";

import type { EntryTrack } from "@/lib/auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      entryTrack: EntryTrack | null;
    } & DefaultSession["user"];
  }
}
