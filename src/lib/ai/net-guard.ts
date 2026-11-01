import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "../errors";
import { localModelsOff } from "./local-gate";

/**
 * On the hosted site a saved model's address must be a public https:// host. This stops anyone from
 * pointing "their model" at the server's own network and reading the answer back (SSRF).
 * On a creator's own computer local addresses are allowed (Ollama, llama.cpp).
 */
const PRIVATE_NAME = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa|metadata(\..*)?)$/i;

export function isPrivateAddress(ip: string): boolean {
  const value = ip.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(value) === 4) {
    const [a, b] = value.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  if (isIP(value) === 6) {
    if (value === "::" || value === "::1") return true;
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(value);
  }
  return false;
}

/** Throws a short AppError when the hosted site should not call this address. */
export async function assertPublicModelUrl(baseUrl: string, hosted = localModelsOff(), resolve = lookup): Promise<void> {
  if (!hosted) return;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new AppError("The base URL must start with https://.");
  }
  const message = "On this hosted site the model must have a public https:// address.";
  if (url.protocol !== "https:") throw new AppError(message);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (PRIVATE_NAME.test(host) || isPrivateAddress(host)) throw new AppError(message);
  if (isIP(host)) return;
  let addresses: { address: string }[];
  try {
    addresses = await resolve(host, { all: true });
  } catch {
    throw new AppError(`Could not find ${host}. Check the base URL.`);
  }
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) throw new AppError(message);
}
