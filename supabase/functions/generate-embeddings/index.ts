// deno-lint-ignore-file no-explicit-any
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function sb(path: string, init: RequestInit = {}) {
  const url = `${env("SUPABASE_URL")}/rest/v1${path}`;
  const headers = {
    apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
    Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
    "Content-Type": "application/json",
  };
  return fetch(url, { ...init, headers: { ...headers, ...(init.headers as any) } });
}

async function embedBatch(chunks: { id: string; segment_text: string }[]) {
  const body = {
    input: chunks.map(c => c.segment_text),
    model: "text-embedding-3-small",
  };
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.data.map((d: any) => d.embedding as number[]);
}

serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Auth: require service-role (from caller)
    const auth = req.headers.get("authorization") ?? "";
    if (!auth.includes(env("SUPABASE_SERVICE_ROLE_KEY").slice(0, 12))) {
      return new Response("Unauthorized", { status: 401 });
    }

    const { youtube_id, videoId, limit = 500 } = await req.json();

    let video_id: string;

    // Accept either youtube_id or videoId
    if (videoId) {
      video_id = videoId;
      console.log(`Generating embeddings for video_id: ${video_id}`);
    } else if (youtube_id) {
      console.log(`Generating embeddings for youtube_id: ${youtube_id}`);
      
      // Get video_id from youtube_id
      const videoRes = await sb(`/videos?select=id&youtube_id=eq.${youtube_id}&limit=1`);
      if (!videoRes.ok) {
        throw new Error(`Failed to fetch video: ${videoRes.status} ${await videoRes.text()}`);
      }
      const videos = await videoRes.json();
      if (!Array.isArray(videos) || videos.length === 0) {
        return new Response(`Video not found for youtube_id: ${youtube_id}`, { status: 404 });
      }
      video_id = videos[0].id;
    } else {
      return new Response("Missing youtube_id or videoId", { status: 400 });
    }

    // 2) Pull unembedded segments for this video
    const sel = await sb(
      `/transcript_segments?select=id,segment_text&embedding=is.null&video_id=eq.${video_id}&limit=${limit}`
    );
    
    if (!sel.ok) {
      throw new Error(`Failed to fetch segments: ${sel.status} ${await sel.text()}`);
    }

    const segs = await sel.json();
    
    if (!Array.isArray(segs) || segs.length === 0) {
      console.log(`No unembedded segments found for video ${video_id}`);
      return new Response(
        JSON.stringify({ ok: true, embedded: 0, processedCount: 0 }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${segs.length} segments to embed`);

    // 3) Batch in groups of 128 (safe for OpenAI)
    const chunk = <T,>(arr: T[], n: number) => 
      arr.reduce<T[][]>((a, _, i) => (i % n ? a : [...a, arr.slice(i, i + n)]), []);
    
    let total = 0;
    const groups = chunk(segs, 128);
    
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex];
      console.log(`Processing batch ${groupIndex + 1}/${groups.length} (${group.length} segments)`);
      
      const vectors = await embedBatch(group);
      
      // 4) Patch embeddings back
      for (let i = 0; i < group.length; i++) {
        const seg = group[i];
        const embedding = vectors[i];
        
        const upd = await sb(`/transcript_segments?id=eq.${seg.id}`, {
          method: "PATCH",
          body: JSON.stringify({ embedding }),
          headers: { Prefer: "return=minimal" },
        });
        
        if (!upd.ok) {
          throw new Error(`Patch failed: ${upd.status} ${await upd.text()}`);
        }
      }
      
      total += group.length;
      console.log(`✓ Embedded batch ${groupIndex + 1}/${groups.length}`);
    }

    console.log(`✓ Total embeddings generated: ${total}`);

    return new Response(
      JSON.stringify({ ok: true, embedded: total, processedCount: total }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-embeddings error:", e);
    return new Response(`generate-embeddings error: ${String(e)}`, { status: 500 });
  }
});
