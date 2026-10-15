/**
 * Whether the current performance's recording should still be running.
 *
 * Only the PERFORMANCE decides: the singer is on stage, recording is enabled
 * for the room, and a song is loaded. Mic mute, pause, and whether the mix is
 * currently on air are deliberately NOT inputs — none of them ends a take,
 * so none of them may trigger the "Save this performance?" prompt. The take
 * ends on Stop (song cleared), a new song, the turn ending or leaving.
 */
export function shouldKeepRecording(s: {
  active: boolean;
  recordingEnabled: boolean;
  songKey: string | null;
}): boolean {
  return s.active && s.recordingEnabled && !!s.songKey;
}
