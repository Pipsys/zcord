Place your custom presence sounds in this folder:

- voice-join.wav
- voice-leave.wav

Default lookup uses these relative paths:
- sounds/voice-join.wav
- sounds/voice-leave.wav

You can override paths in client/.env:
- VITE_VOICE_JOIN_SOUND_URL
- VITE_VOICE_LEAVE_SOUND_URL
- VITE_VOICE_PRESENCE_SOUND_VOLUME

Notes:
- Recommended format: PCM WAV, 44.1kHz or 48kHz, short (0.1s - 1s).
- If a file is missing or cannot be played, the app falls back to built-in beep tones.
