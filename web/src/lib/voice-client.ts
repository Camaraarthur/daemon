/**
 * Browser-side voice client — Deepgram streaming STT.
 * Connects directly to Deepgram WebSocket from the browser.
 * Returns transcriptions as callbacks.
 */

export class VoiceClient {
  private socket: WebSocket | null = null
  private mediaRecorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  public isListening = false

  constructor(
    private onTranscript: (text: string, isFinal: boolean) => void,
    private onError: (error: string) => void,
  ) {}

  async start() {
    try {
      // Get Deepgram key from our API
      const res = await fetch('/api/voice')
      const { key, error } = await res.json()
      if (error || !key) {
        this.onError(error || 'No voice key')
        return
      }

      // Get microphone access
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })

      // Connect to Deepgram
      const dgUrl = `wss://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true&interim_results=true&endpointing=300&vad_events=true`
      this.socket = new WebSocket(dgUrl, ['token', key])

      this.socket.onopen = () => {
        console.log('[voice] Connected to Deepgram')
        this.isListening = true
        this.startRecording()
      }

      this.socket.onmessage = (event) => {
        const data = JSON.parse(event.data)
        if (data.type === 'Results') {
          const alt = data.channel?.alternatives?.[0]
          if (alt?.transcript) {
            this.onTranscript(alt.transcript, data.is_final)
          }
        }
      }

      this.socket.onerror = (event) => {
        console.error('[voice] WebSocket error:', event)
        this.onError('Voice connection error')
        this.stop()
      }

      this.socket.onclose = () => {
        console.log('[voice] Disconnected from Deepgram')
        this.isListening = false
      }
    } catch (err: any) {
      this.onError(err?.message || 'Failed to start voice')
      this.stop()
    }
  }

  private startRecording() {
    if (!this.stream) return

    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType: 'audio/webm;codecs=opus',
    })

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0 && this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(event.data)
      }
    }

    this.mediaRecorder.start(250) // Send audio every 250ms
  }

  stop() {
    this.isListening = false

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop()
    }
    this.mediaRecorder = null

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close()
    }
    this.socket = null

    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
    }
    this.stream = null
  }
}
