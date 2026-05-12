import { WEBRTC_BASE } from "./api";

export type WebRtcHandle = {
  pc: RTCPeerConnection;
  destroy: () => void;
  rtt: () => Promise<number | null>;
};

export async function attachWebRtc(
  video: HTMLVideoElement,
  pathName: string,
  onDisconnect?: () => void,
): Promise<WebRtcHandle> {
  const pc = new RTCPeerConnection({ iceServers: [] });

  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  const trackPromise = new Promise<void>((resolve) => {
    pc.ontrack = (ev) => {
      if (ev.streams && ev.streams[0]) {
        video.srcObject = ev.streams[0];
        try {
          (ev.receiver as RTCRtpReceiver & { playoutDelayHint?: number }).playoutDelayHint = 0;
        } catch {
          /* ignore */
        }
        resolve();
      }
    };
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const onChange = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", onChange);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", onChange);
    window.setTimeout(resolve, 1500);
  });

  const url = `${WEBRTC_BASE}/${pathName}/whep`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: pc.localDescription?.sdp ?? "",
  });
  if (!r.ok) {
    pc.close();
    throw new Error(`WHEP HTTP ${r.status}`);
  }
  const answer = await r.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answer });

  pc.addEventListener("iceconnectionstatechange", () => {
    if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
      onDisconnect?.();
    }
  });

  await Promise.race([
    trackPromise,
    new Promise<void>((_resolve, reject) =>
      window.setTimeout(() => reject(new Error("no track within 4s")), 4000),
    ),
  ]);

  return {
    pc,
    destroy: () => {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      video.srcObject = null;
    },
    rtt: async () => {
      try {
        const stats = await pc.getStats();
        let rtt: number | null = null;
        stats.forEach((report) => {
          if (
            report.type === "candidate-pair" &&
            (report as RTCIceCandidatePairStats).state === "succeeded" &&
            (report as RTCIceCandidatePairStats).currentRoundTripTime != null
          ) {
            rtt = (report as RTCIceCandidatePairStats).currentRoundTripTime ?? null;
          }
        });
        return rtt;
      } catch {
        return null;
      }
    },
  };
}
