import { describe, expect, it } from "vitest";
import { assertPublicModelUrl, isPrivateAddress } from "./net-guard";

const publicDns = (async () => [{ address: "142.250.1.1", family: 4 }]) as never;
const privateDns = (async () => [{ address: "169.254.169.254", family: 4 }]) as never;

describe("model address guard", () => {
  it("knows private addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "0.0.0.0"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "142.250.1.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("allows public https hosts on the hosted site", async () => {
    await expect(assertPublicModelUrl("https://api.llama.com/v1", true, publicDns)).resolves.toBeUndefined();
  });

  it("refuses http, local names, private IPs and names that point inside", async () => {
    await expect(assertPublicModelUrl("http://api.example.com/v1", true, publicDns)).rejects.toThrow(/public https/);
    await expect(assertPublicModelUrl("https://localhost:8080/v1", true, publicDns)).rejects.toThrow(/public https/);
    await expect(assertPublicModelUrl("https://169.254.169.254/latest", true, publicDns)).rejects.toThrow(/public https/);
    await expect(assertPublicModelUrl("https://[::1]/v1", true, publicDns)).rejects.toThrow(/public https/);
    await expect(assertPublicModelUrl("https://sneaky.example.com/v1", true, privateDns)).rejects.toThrow(/public https/);
  });

  it("does nothing on a creator's own computer", async () => {
    await expect(assertPublicModelUrl("http://127.0.0.1:11434/v1", false, privateDns)).resolves.toBeUndefined();
  });
});
