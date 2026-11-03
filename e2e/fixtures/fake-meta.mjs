import http from "node:http";
const seen = []; let n = 0;
http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const auth = (req.headers.authorization || "").slice(-4);
  if (req.url === "/v1/models") { res.setHeader("content-type","application/json"); return res.end(JSON.stringify({ data: [{ id: "muse-spark-1.3" }, { id: "muse-image-1.0" }, { id: "muse-voice-transcribe-1.0" }] })); }
  if (req.url === "/v1/__log") { res.setHeader("content-type","application/json"); return res.end(JSON.stringify(seen)); }
  if (req.url === "/v1/chat/completions") {
    const j = JSON.parse(body); n++;
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
