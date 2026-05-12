import Hls from "hls.js";

export type HlsHandle = {
  hls: Hls | null;
  destroy: () => void;
  latency: () => number | null;
};

export type HlsOpts = {
  onFatal?: () => void;
};

export function attachHls(video: HTMLVideoElement, hlsUrl: string, opts: HlsOpts = {}): HlsHandle {
  const src = hlsUrl.endsWith("/") ? `${hlsUrl}index.m3u8` : `${hlsUrl}/index.m3u8`;

  if (Hls.isSupported()) {
    const hls = new Hls({
      lowLatencyMode: true,
      enableWorker: true,
      backBufferLength: 0,
      maxBufferLength: 4,
      maxMaxBufferLength: 8,
      liveSyncDuration: 0.5,
      liveMaxLatencyDuration: 2,
      liveDurationInfinity: true,
      maxLiveSyncPlaybackRate: 2.0,
      manifestLoadingMaxRetry: 10,
    });
    hls.loadSource(src);
    hls.attachMedia(video);

    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
        return;
      }
      opts.onFatal?.();
    });

    let lastT = 0;
    let stalled = 0;
    const watchdog = window.setInterval(() => {
      if (video.paused || video.ended) return;
      if (video.currentTime === lastT) {
        stalled += 1;
        if (stalled >= 4 && hls.liveSyncPosition != null) {
          video.currentTime = hls.liveSyncPosition;
          video.play().catch(() => {});
          stalled = 0;
        }
      } else {
        stalled = 0;
        lastT = video.currentTime;
      }
    }, 1000);

    return {
      hls,
      destroy: () => {
        window.clearInterval(watchdog);
        try {
          hls.destroy();
        } catch {
          /* ignore */
        }
      },
      latency: () => (typeof hls.latency === "number" && isFinite(hls.latency) ? hls.latency : null),
    };
  }

  // Native HLS (Safari)
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = src;
    return {
      hls: null,
      destroy: () => {
        video.removeAttribute("src");
        video.load();
      },
      latency: () => null,
    };
  }

  return {
    hls: null,
    destroy: () => {},
    latency: () => null,
  };
}

export async function probeManifest(hlsUrl: string): Promise<boolean> {
  const src = hlsUrl.endsWith("/") ? `${hlsUrl}index.m3u8` : `${hlsUrl}/index.m3u8`;
  try {
    const res = await fetch(src, { method: "GET", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}
