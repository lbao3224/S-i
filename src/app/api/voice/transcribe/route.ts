import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as Blob | null;
    const requestedModel = (formData.get("model") as string | null) || process.env.VOICE_MODEL || "openai/whisper-large-v3-turbo";
    const customEndpoint = (formData.get("endpoint") as string | null) || process.env.PHOWHISPER_ENDPOINT || "";
    const clientToken = (formData.get("token") as string | null) || "";
    const token = clientToken || process.env.HF_TOKEN || "";

    if (!audioFile) {
      return NextResponse.json({ error: "Không tìm thấy dữ liệu âm thanh từ micro." }, { status: 400 });
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 1. Nếu có Endpoint tùy chọn (ví dụ tự host PhoWhisper hoặc GPU riêng)
    if (customEndpoint) {
      const headers: Record<string, string> = {
        "Content-Type": audioFile.type || "audio/webm",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(customEndpoint, {
        method: "POST",
        headers,
        body: buffer,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        return NextResponse.json(
          { error: `Máy chủ PhoWhisper Endpoint báo lỗi ${res.status}: ${errorText || res.statusText}` },
          { status: res.status }
        );
      }

      const data = await res.json();
      const text = (data.text || (Array.isArray(data) && data[0]?.text) || "").trim();
      return NextResponse.json({ text });
    }

    // 2. Chạy qua Hugging Face Router
    // PhoWhisper trên Hugging Face không có serverless inference miễn phí.
    // Nếu chọn PhoWhisper mà không có endpoint riêng, tự động dùng Whisper Large v3 Turbo (hỗ trợ tiếng Việt xuất sắc)
    let targetModel = requestedModel;
    if (targetModel.startsWith("vinai/PhoWhisper") || targetModel === "browser-default") {
      targetModel = "openai/whisper-large-v3-turbo";
    }

    const hfHeaders: Record<string, string> = {
      "Content-Type": audioFile.type || "audio/webm",
    };
    if (token) {
      hfHeaders["Authorization"] = `Bearer ${token}`;
    }

    const hfEndpoint = `https://router.huggingface.co/hf-inference/models/${targetModel}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    let res = await fetch(hfEndpoint, {
      method: "POST",
      headers: hfHeaders,
      body: buffer,
      signal: controller.signal,
    }).catch((err) => {
      clearTimeout(timeoutId);
      throw err;
    });
    clearTimeout(timeoutId);

    // Thử fallback sang endpoint api-inference cũ nếu router trả lỗi
    if (!res.ok && res.status !== 401) {
      const legacyEndpoint = `https://api-inference.huggingface.co/models/${targetModel}`;
      const legacyRes = await fetch(legacyEndpoint, {
        method: "POST",
        headers: hfHeaders,
        body: buffer,
      }).catch(() => null);
      if (legacyRes && legacyRes.ok) {
        res = legacyRes;
      }
    }

    if (!res.ok) {
      if (res.status === 401) {
        return NextResponse.json(
          {
            error:
              "Hệ thống nhận diện AI chưa được kích hoạt token máy chủ. Bạn hãy sử dụng Chrome, Edge hoặc Safari để nhận diện giọng nói trực tiếp miễn phí.",
          },
          { status: 401 }
        );
      }
      if (res.status === 503) {
        return NextResponse.json(
          { error: "Mô hình AI đang khởi động trên Hugging Face. Vui lòng thử lại sau 15 giây." },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: `Máy chủ AI trả về lỗi (${res.status}). Bạn hãy thử chuyển sang Trình duyệt mặc định.` },
        { status: res.status }
      );
    }

    const data = await res.json();
    const text = (data.text || (Array.isArray(data) && data[0]?.text) || "").trim();
    return NextResponse.json({ text });
  } catch (error) {
    console.error("[TranscribeAPI] Error:", error);
    return NextResponse.json(
      { error: "Lỗi kết nối khi gửi âm thanh đến máy chủ nhận diện giọng nói." },
      { status: 500 }
    );
  }
}
