import { describe, expect, it } from "vitest";
import { NO_AI_SOURCE, parseAiChoice, usableProvider, type AiOptions } from "./book-source";
import { modelChoices, preferBook, type ProviderView } from "./provider-types";

const options: AiOptions = {
  saved: [
    { id: "p1", kind: "provider", label: "Meta", detail: "", type: "meta", model: "muse-spark-1.3", local: false },
    { id: "b1", kind: "book", label: "Meta key", detail: "", type: "meta", model: "muse-spark-1.3", local: false },
  ],
  localOn: false,
  serverKey: false,
  demo: false,
};

describe("parseAiChoice", () => {
  it("needs some AI source", () => {
    expect(() => parseAiChoice(undefined, undefined, options)).toThrow(NO_AI_SOURCE);
    expect(() => parseAiChoice(undefined, "  ", options)).toThrow(NO_AI_SOURCE);
    expect(() => parseAiChoice({ source: "nope" }, undefined, options)).toThrow(NO_AI_SOURCE);
  });
  it("needs a key for a new provider, except custom", () => {
    expect(() => parseAiChoice({ source: "new", type: "meta" }, undefined, options)).toThrow("Paste your AI key.");
    expect(parseAiChoice({ source: "new", type: "custom", baseUrl: "http://x/v1", model: "m" }, undefined, options).source).toBe("new");
  });
  it("treats the old aiKey field as a new Meta key", () => {
    expect(parseAiChoice(undefined, "sk-1234567890", options)).toEqual({ source: "new", type: "meta", apiKey: "sk-1234567890" });
  });
  it("accepts only saved models the creator owns", () => {
    expect(parseAiChoice({ source: "provider", providerId: "p1", model: "muse-spark-1.2" }, undefined, options).source).toBe("provider");
    expect(parseAiChoice({ source: "book", bookId: "b1" }, undefined, options).source).toBe("book");
    expect(() => parseAiChoice({ source: "provider", providerId: "someone-else" }, undefined, options)).toThrow(/not available/);
    expect(() => parseAiChoice({ source: "book", bookId: "p1" }, undefined, options)).toThrow(/not available/);
  });
  it("allows the server key and demo mode only where they exist", () => {
    expect(() => parseAiChoice({ source: "server" }, undefined, options)).toThrow(NO_AI_SOURCE);
    expect(() => parseAiChoice({ source: "demo" }, undefined, options)).toThrow(NO_AI_SOURCE);
    expect(parseAiChoice({ source: "server" }, undefined, { ...options, serverKey: true }).source).toBe("server");
    expect(parseAiChoice({ source: "demo" }, undefined, { ...options, demo: true }).source).toBe("demo");
  });
});

const view = (over: Partial<ProviderView>): ProviderView => ({
  id: "x",
  label: "x",
  type: "meta",
  typeName: "Meta",
  baseUrl: "",
  model: "muse-spark-1.3",
  role: "both",
  priority: 0,
  enabled: true,
  hasKey: true,
  keyLast4: "abcd",
  localModel: "",
  canTranscribe: true,
  lastTestOk: null,
  lastTestMsg: "",
  lastTestAt: null,
  ...over,
});

describe("usableProvider", () => {
  it("hides local models where they can't run", () => {
    expect(usableProvider(view({ type: "local", hasKey: false }), false)).toBe(false);
    expect(usableProvider(view({ type: "local", hasKey: false }), true)).toBe(true);
  });
  it("needs a key, a writer role and the model turned on", () => {
    expect(usableProvider(view({}), false)).toBe(true);
    expect(usableProvider(view({ hasKey: false }), false)).toBe(false);
    expect(usableProvider(view({ enabled: false }), false)).toBe(false);
    expect(usableProvider(view({ role: "transcription" }), false)).toBe(false);
  });
});

describe("preferBook", () => {
  const chain = [
    { id: "a", type: "openai", model: "gpt", role: "writer" },
    { id: "b", type: "meta", model: "muse-spark-1.3", role: "both" },
    { id: "c", type: "local", model: "llama-3.2-3b", role: "writer" },
  ];
  it("puts the book's model first and applies its model id for writing", () => {
    expect(preferBook(chain, "b", "muse-spark-1.2", "writer").map((item) => `${item.id}:${item.model}`)).toEqual([
      "b:muse-spark-1.2",
      "a:gpt",
      "c:llama-3.2-3b",
    ]);
  });
  it("keeps speech models and local models as they are", () => {
    expect(preferBook(chain, "b", "muse-spark-1.2", "transcription")[0].model).toBe("muse-spark-1.3");
    expect(preferBook(chain, "c", "other", "writer")[0].model).toBe("llama-3.2-3b");
  });
  it("falls back to the account order when the model is gone", () => {
    expect(preferBook(chain, "zzz", "", "writer")).toBe(chain);
    expect(preferBook(chain, "", "", "writer")).toBe(chain);
  });
});

describe("modelChoices", () => {
  it("lists Meta's newest model first and keeps a custom one", () => {
    expect(modelChoices("meta")[0]).toBe("muse-spark-1.3");
    expect(modelChoices("meta", "my-model")[0]).toBe("my-model");
  });
});
