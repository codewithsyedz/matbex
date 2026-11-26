import { promises as dns } from "node:dns";

/** Minimal replacement for Deno.resolveDns used by verify-custom-domain. */
export async function resolveDns(name: string, type: "TXT" | "CNAME" | "A" | "AAAA"): Promise<any[]> {
  switch (type) {
    case "TXT": return dns.resolveTxt(name);
    case "CNAME": return dns.resolveCname(name);
    case "A": return dns.resolve4(name);
    case "AAAA": return dns.resolve6(name);
  }
}
