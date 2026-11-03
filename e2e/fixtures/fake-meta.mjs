import http from "node:http";
import fs from "node:fs";
const pics = [0, 1, 2].map((i) => fs.readFileSync(new URL(`./fake-picture-${i}.jpg`, import.meta.url)).toString("base64"));
let pn = 0;
const seen = []; let n = 0;
http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const auth = (req.headers.authorization || "").slice(-4);
  if (req.url === "/v1/models") { res.setHeader("content-type","application/json"); return res.end(JSON.stringify({ data: [{ id: "muse-spark-1.3" }, { id: "muse-image-1.0" }, { id: "muse-voice-transcribe-1.0" }] })); }
  if (req.url === "/v1/__log") { res.setHeader("content-type","application/json"); return res.end(JSON.stringify(seen)); }
  if (req.url === "/v1/images/generations") {
    const j = JSON.parse(body); pn++;
    seen.push({ kind: "image", model: j.model, size: j.size, output_format: j.output_format, reasoning_strength: j.reasoning_strength, auth4: auth, prompt: String(j.prompt).slice(0, 60) });
    const allowed = ["model", "prompt", "n", "size", "response_format", "output_format", "reasoning_strength", "tool_enablement"];
    if (Object.keys(j).some((k) => !allowed.includes(k))) { res.statusCode = 400; return res.end(JSON.stringify({ error: { message: "unknown field" } })); }
    if (pn === 2) { res.statusCode = 503; return res.end(JSON.stringify({ error: { message: "busy" } })); }
    res.setHeader("content-type","application/json");
    return res.end(JSON.stringify({ data: [{ b64_json: pics[pn % 3] }], output_format: "jpeg", usage: { input_tokens: 40, output_tokens: 0 } }));
  }
  if (req.url === "/v1/chat/completions") {
    const j = JSON.parse(body);
    if (j.response_format?.json_schema?.name === "storyboard") {
      const segs = (j.messages[1].content.match(/^\d+\. /gm) || []).length;
      const hasQuotes = /\nQuotes:\n/.test(j.messages[1].content);
      seen.push({ kind: "storyboard", model: j.model, auth4: auth });
      const scenes = [{ kind: "picture", segment: 0, prompt: "A night bus window with city lights blurred in the rain", quote: -1 }];
      if (hasQuotes) scenes.push({ kind: "quote", segment: Math.min(1, segs - 1), prompt: "", quote: 0 });
      scenes.push({ kind: "picture", segment: 1, prompt: "An empty bus stop at dawn", quote: -1 });
      scenes.push({ kind: "quote", segment: 0, prompt: "", quote: 99 });
      res.setHeader("content-type","application/json");
      return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ scenes }) } }], usage: { prompt_tokens: 700, completion_tokens: 120 } }));
    }
    n++;
    seen.push({ n, model: j.model, roles: j.messages.map(m=>m.role), rf: j.response_format?.type, auth4: auth, user: j.messages[1].content.slice(0, 60) });
    if (n === 2) { res.statusCode = 429; return res.end(JSON.stringify({ error: { message: "slow down" } })); }
    const isLast = /last chapter/.test(j.messages[0].content);
    const content = JSON.stringify({ title: "x", segments: [
      { text: "Welcome. This part was written by the pretend Meta writer.", pause: "short" },
      { text: "Night buses are where people think, and twenty-one of them said so.", pause: isLast ? "long" : "short" },
    ]});
    res.setHeader("content-type","application/json");
    return res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 500, completion_tokens: 80 } }));
  }
  res.statusCode = 404; res.end("{}");
}).listen(43999, "127.0.0.1", () => console.log("fake meta up"));
