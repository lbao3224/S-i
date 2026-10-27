export type BrowserRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string; confidence?: number }> & { isFinal?: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

export type BrowserRecognitionConstructor = new () => BrowserRecognition;

export function getBrowserRecognition(): BrowserRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as typeof window & {
    SpeechRecognition?: BrowserRecognitionConstructor;
    webkitSpeechRecognition?: BrowserRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

export function isMobileBrowser(): boolean {
  return typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function voiceSupportMessage(): string {
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return "Micro chỉ hoạt động khi mở trang bằng HTTPS. Hãy mở đúng liên kết https:// rồi thử lại.";
  }
  if (isMobileBrowser()) {
    return "Trình duyệt điện thoại này chưa hỗ trợ nhận giọng nói trực tiếp. Bạn có thể bấm mic trên bàn phím để nói câu bán hàng.";
  }
  return "Trình duyệt này chưa bật Web Speech API. Bạn có thể dùng Chrome, Edge hoặc chọn mô hình AI trong Cài đặt.";
}

export async function requestMicrophoneAccess(): Promise<string | null> {
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return "Micro chỉ hoạt động khi mở trang bằng HTTPS (hoặc localhost). Hãy kiểm tra lại địa chỉ trang web.";
  }
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "Trình duyệt này không hỗ trợ truy cập Micro. Hãy dùng Chrome hoặc Edge phiên bản mới.";
  }
  try {
    if (typeof navigator.permissions?.query === "function") {
      try {
        const permissionStatus = await navigator.permissions.query({ name: "microphone" as PermissionName });
        if (permissionStatus.state === "denied") {
          return "Micro đã bị chặn. Hãy bấm biểu tượng khóa 🔒 trên thanh địa chỉ → bật Cho phép Micro, rồi tải lại trang.";
        }
      } catch {
        // Một số trình duyệt không hỗ trợ query 'microphone'
      }
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return null;
  } catch (error) {
    const name = error instanceof DOMException ? error.name : (error as { name?: string })?.name ?? "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
      return "Trình duyệt chưa được cấp quyền Micro. Bấm vào biểu tượng khóa 🔒 trên thanh địa chỉ → chọn Cho phép Micro, rồi tải lại trang.";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") return "Không tìm thấy thiết bị micro nào được kết nối.";
    if (name === "NotReadableError" || name === "TrackStartError") return "Micro đang được dùng bởi ứng dụng khác. Hãy đóng ứng dụng đó rồi thử lại.";
    return "Không thể mở micro. Hãy kiểm tra quyền micro của trình duyệt rồi thử lại.";
  }
}

export function voiceErrorMessage(error: string): string {
  if (error === "not-allowed") return "Trình duyệt chưa cho phép Micro. Bấm vào biểu tượng 🔒 trên thanh địa chỉ → chọn Cho phép Micro, rồi tải lại trang.";
  if (error === "service-not-allowed") return "Dịch vụ giọng nói chưa được bật. Trên Windows: mở Cài đặt → Quyền riêng tư & bảo mật → Nhận dạng giọng nói → bật 'Nhận dạng giọng nói trực tuyến'. Trên iPhone: bật Siri & Đọc chính tả.";
  if (error === "audio-capture") return "Không tìm thấy micro. Hãy kiểm tra kết nối micro của thiết bị.";
  if (error === "network") return "Không thể kết nối đến máy chủ nhận giọng nói của trình duyệt. Hãy kiểm tra mạng hoặc dùng Google Chrome / Microsoft Edge.";
  if (error === "no-speech") return "Sổ chưa nghe thấy tiếng nói. Hãy nói to rõ hơn rồi thử lại.";
  if (error === "language-not-supported") return "Trình duyệt không hỗ trợ nhận dạng tiếng Việt. Hãy dùng Chrome, Edge hoặc Safari.";
  return "Không nghe rõ. Bạn thử nói to rõ hơn hoặc gõ câu bán hàng.";
}

export const safariSpeechEndedWithoutResultMessage = "Safari đã dừng nhận giọng nói mà không trả kết quả. Hãy bật Siri và Đọc chính tả trong Cài đặt iPhone, hoặc dùng mic trên bàn phím để nhập câu bán hàng.";

export function playChimeSound() {
  if (typeof window === "undefined") return;
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, ctx.currentTime);
    gain1.gain.setValueAtTime(0.3, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.35);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1320, ctx.currentTime + 0.12);
    gain2.gain.setValueAtTime(0.35, ctx.currentTime + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.12);
    osc2.stop(ctx.currentTime + 0.7);
  } catch {
    // Trình duyệt có thể chặn âm thanh nếu chưa có tương tác
  }
}

export function playPaymentSpeakerAnnouncement(amount: number, method: "cash" | "transfer" | "debt" | "settle_debt", customer = "") {
  playChimeSound();
  import("@/lib/ledger").then(({ formatMoneyToWords }) => {
    const moneyWords = formatMoneyToWords(amount);
    let speakText = "";
    if (method === "transfer") {
      speakText = `Sổ Ơi thông báo. Đã nhận thành công ${moneyWords} đồng qua chuyển khoản.`;
    } else if (method === "debt") {
      speakText = `Sổ Ơi thông báo. Đã ghi nợ ${moneyWords} đồng cho ${customer || "khách hàng"}.`;
    } else if (method === "settle_debt") {
      speakText = `Sổ Ơi thông báo. Đã thu thành công ${moneyWords} đồng tiền nợ từ ${customer || "khách hàng"}.`;
    } else {
      speakText = `Sổ Ơi thông báo. Thanh toán thành công ${moneyWords} đồng tiền mặt.`;
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(speakText);
        utterance.lang = "vi-VN";
        utterance.rate = 0.95;
        window.speechSynthesis.speak(utterance);
      } catch {
        // Bỏ qua lỗi
      }
    }
  }).catch(() => {});
}

export class AudioVoiceRecorder {
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  async start(): Promise<void> {
    this.chunks = [];
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let mimeType = "";
    if (typeof MediaRecorder !== "undefined") {
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        mimeType = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/webm")) {
        mimeType = "audio/webm";
      } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
        mimeType = "audio/mp4";
      } else if (MediaRecorder.isTypeSupported("audio/ogg")) {
        mimeType = "audio/ogg";
      }
    }
    this.mediaRecorder = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream);
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    this.mediaRecorder.start(200);
  }

  async stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error("Chưa khởi tạo micro"));
        return;
      }
      this.mediaRecorder.onstop = () => {
        const type = this.mediaRecorder?.mimeType || "audio/webm";
        const blob = new Blob(this.chunks, { type });
        this.stream?.getTracks().forEach((track) => track.stop());
        this.stream = null;
        this.mediaRecorder = null;
        resolve(blob);
      };
      if (this.mediaRecorder.state !== "inactive") {
        this.mediaRecorder.stop();
      }
    });
  }

  cancel() {
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
        this.mediaRecorder.stop();
      }
    } catch (_) {}
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.mediaRecorder = null;
    this.chunks = [];
  }
}

export async function transcribeAudioWithApi(
  audioBlob: Blob,
  options?: {
    model?: string;
    endpoint?: string;
    token?: string;
  }
): Promise<string> {
  const formData = new FormData();
  formData.append("audio", audioBlob, "audio.webm");
  if (options?.model) formData.append("model", options.model);
  if (options?.endpoint) formData.append("endpoint", options.endpoint);
  if (options?.token) formData.append("token", options.token);

  const res = await fetch("/api/voice/transcribe", {
    method: "POST",
    body: formData,
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return (data.text || "").trim();
}

export async function sendAudioToPhoWhisper(
  audioBlob: Blob,
  model = "vinai/PhoWhisper-small",
  token = "",
  endpoint = ""
): Promise<string> {
  return transcribeAudioWithApi(audioBlob, { model, endpoint, token });
}
