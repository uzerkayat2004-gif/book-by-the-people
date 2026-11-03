// A pretend Meta API that answers the feature writer's steps (map, reduce, plan, write, edit) slowly,
// so a big book has to be written over several requests. Port 43998. DELAY_MS sets each call's wait.
import http from "node:http";
const DELAY = Number(process.env.DELAY_MS || 4000);
const calls = {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reply = (res, obj) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }], usage: { prompt_tokens: 900, completion_tokens: 300 } })); };
const words = (t, n) => t.split(/\s+/).slice(0, n).join(" ");
http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  if (req.url === "/v1/models") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ data: [{ id: "muse-spark-1.3" }, { id: "muse-image-1.0" }] })); }
  if (req.url === "/v1/__calls") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(calls)); }
  if (req.url !== "/v1/chat/completions") { res.statusCode = 404; return res.end("{}"); }
  const j = JSON.parse(body);
  const name = j.response_format?.json_schema?.name ?? "plain";
  calls[name] = (calls[name] ?? 0) + 1;
  const user = typeof j.messages[1].content === "string" ? j.messages[1].content : "";
  let data = {};
  try { data = JSON.parse(user); } catch {}
  await wait(DELAY);
  if (name === "voice_groups") {
    const themes = ["patience", "humour", "strictness"];
    const groups = themes.map((t) => ({ label: `Teachers and ${t}`, summary: `People who value ${t}.`, refs: [], phrases: [], standouts: [] }));
    (data.contributions ?? []).forEach((c, i) => {
      const g = groups[/funny|laugh|joke/i.test(c.text) ? 1 : /strict|rule|firm/i.test(c.text) ? 2 : 0];
      g.refs.push(c.ref);
      if (g.phrases.length < 3) g.phrases.push({ ref: c.ref, text: words(c.text, 6) });
      if (i % 40 === 0) g.standouts.push({ ref: c.ref, text: c.text, why: "vivid" });
    });
    return reply(res, { groups: groups.filter((g) => g.refs.length) });
  }
  if (name === "clusters") {
    const by = {};
    for (const g of data.groups ?? []) (by[g.label] ??= []).push(g.gid);
    return reply(res, { clusters: Object.entries(by).map(([label, gids]) => ({ label, summary: `Everyone who said ${label.toLowerCase()}.`, gids })) });
  }
  if (name === "book_plan") {
    const ids = (data.clusters ?? []).map((c) => c.id);
    const pool = (data.standoutPool ?? []).map((s) => s.ref);
    return reply(res, { form: "chapters", arc: "From patience to laughter to firm lines.", standfirst: "Fifteen hundred people on what a good teacher is.", preface: `This book was written from the words of ${data.totalVoices} people in ${data.countries} countries. Every quotation is exact.`,
      sections: ids.map((id, i) => ({ title: `Part ${i + 1}`, role: ["hook", "build", "contrast", "resolution", "closing"][Math.min(i, 4)], purpose: "Tell this view.", clusterIds: [id], standoutRefs: pool.slice(i, i + 1) })) });
  }
  if (name === "book_section") {
    const blocks = [];
    for (const c of data.clusters ?? []) blocks.push({ type: "p", text: `Many of you said ${c.label.toLowerCase()}, and ${c.count} people put it in their own words, like "${c.says?.[0] ?? ""}".`, ref: "", cluster: c.id });
    for (const s of data.standouts ?? []) { blocks.push({ type: "p", text: `${s.name || "One person"} in ${s.place || "their town"} said it best.`, ref: "", cluster: "" }); blocks.push({ type: "quote", text: "", ref: s.ref, cluster: "" }); }
    return reply(res, { blocks });
  }
  if (name === "book_edit") return reply(res, { paragraphs: [], titles: [] });
  return reply(res, {});
}).listen(43998, "127.0.0.1", () => console.log("fake meta feature up"));
