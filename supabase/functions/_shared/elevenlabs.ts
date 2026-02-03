import { supabase } from "./supabase.ts";

interface ElevenLabsKey {
  id: string;
  api_key: string;
  name: string;
  usage_count: number;
  is_active: boolean;
}

export async function getNextElevenLabsKey(): Promise<{ key: string; keyId: string } | null> {
  // Get the least used active key
  const { data: keys, error } = await supabase
    .from("elevenlabs_keys")
    .select("*")
    .eq("is_active", true)
    .order("usage_count", { ascending: true })
    .limit(1);

  if (error || !keys || keys.length === 0) {
    console.error("No active ElevenLabs keys found:", error);
    return null;
  }

  const selectedKey = keys[0] as ElevenLabsKey;

  // Increment usage count
  await supabase
    .from("elevenlabs_keys")
    .update({
      usage_count: selectedKey.usage_count + 1,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", selectedKey.id);

  console.log(`Using ElevenLabs key: ${selectedKey.name} (usage: ${selectedKey.usage_count + 1})`);

  return {
    key: selectedKey.api_key,
    keyId: selectedKey.id,
  };
}

export async function generateSpeech(
  text: string,
  voiceId: string = "onwK4e9ZLuTAKqWW03F9" // Daniel - Arabic-friendly voice
): Promise<ArrayBuffer | null> {
  const keyData = await getNextElevenLabsKey();
  
  if (!keyData) {
    throw new Error("No active ElevenLabs API keys available");
  }

  console.log(`Generating speech with voice ${voiceId}, text length: ${text.length}`);

  // IMPORTANT: output_format must be passed as query parameter, NOT in request body
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": keyData.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.5,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("ElevenLabs error:", response.status, errorText);
    throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
  }

  const audioBuffer = await response.arrayBuffer();
  console.log("Voice generated successfully, size:", audioBuffer.byteLength);

  return audioBuffer;
}
