"""
Multi-stream AI worker.
Reads JSON commands from stdin:
  {"cmd":"add",    "streamId":"...", "rtspUrl":"..."}
  {"cmd":"remove", "streamId":"..."}
  {"cmd":"quit"}
Writes JSON detections to stdout.
"""
import sys, os, json, time, threading, re
import cv2, numpy as np, mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

HERE = os.path.dirname(os.path.abspath(__file__))
ENROLLMENT_DIR = os.path.join(HERE, 'enrollments')
MODEL_PATH = os.path.join(HERE, 'blaze_face_short_range.tflite')
FRAME_SKIP = 2               # process every Nth frame per stream
RECOGNITION_THRESHOLD = 115

# ── Download model if needed ──────────────────────────────────
if not os.path.exists(MODEL_PATH):
    import urllib.request
    sys.stdout.write(json.dumps({'type': 'info', 'message': 'Downloading face model...'}) + '\n')
    sys.stdout.flush()
    urllib.request.urlretrieve(
        'https://storage.googleapis.com/mediapipe-models/face_detector/'
        'blaze_face_short_range/float16/latest/blaze_face_short_range.tflite',
        MODEL_PATH)

# ── Single shared detector (thread-safe in MediaPipe Tasks) ──
base_options = mp_python.BaseOptions(model_asset_path=MODEL_PATH)
detector_options = mp_vision.FaceDetectorOptions(
    base_options=base_options,
    min_detection_confidence=0.5,
    min_suppression_threshold=0.3,
)
shared_detector = mp_vision.FaceDetector.create_from_options(detector_options)
detector_lock = threading.Lock()

# ── LBPH recognizer (shared, rebuilt on enrollment change) ───
recognizer = cv2.face.LBPHFaceRecognizer_create()
names_map = {}
recognizer_ready = False
recognizer_lock = threading.Lock()


def log(obj):
    sys.stdout.write(json.dumps(obj) + '\n')
    sys.stdout.flush()


def train_recognizer():
    global recognizer_ready, names_map
    if not os.path.isdir(ENROLLMENT_DIR):
        return
    faces, labels, name_to_label, next_id = [], [], {}, [0]

    def get_label(base):
        if base not in name_to_label:
            name_to_label[base] = next_id[0]
            next_id[0] += 1
        return name_to_label[base]

    for fname in sorted(os.listdir(ENROLLMENT_DIR)):
        if not fname.lower().endswith(('.jpg', '.jpeg', '.png')):
            continue
        p = os.path.join(ENROLLMENT_DIR, fname)
        img_bgr = cv2.imread(p)
        if img_bgr is None:
            continue
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        rgb  = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        stem = os.path.splitext(fname)[0]
        base = re.sub(r'_\d+$', '', stem)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        with detector_lock:
            result = shared_detector.detect(mp_img)
        if result.detections:
            bb = result.detections[0].bounding_box
            ih, iw = gray.shape
            x = max(0, bb.origin_x); y = max(0, bb.origin_y)
            w = min(bb.width, iw - x); h = min(bb.height, ih - y)
            crop = gray[y:y+h, x:x+w]
            if crop.size > 0:
                faces.append(cv2.resize(crop, (120, 120)))
                labels.append(get_label(base))
                log({'type': 'info', 'message': f'Enrolled: {fname} -> {base}'})
        else:
            log({'type': 'warning', 'message': f'No face in enrollment: {fname}'})

    with recognizer_lock:
        if faces:
            recognizer.train(faces, np.array(labels))
            names_map = {v: k.replace('_', ' ') for k, v in name_to_label.items()}
            recognizer_ready = True
            summary = {names_map[l]: labels.count(l) for l in set(labels)}
            log({'type': 'info', 'message': f'Trained: {summary}'})
        else:
            recognizer_ready = False
            log({'type': 'warning', 'message': 'No faces enrolled — recognition disabled'})


# ── Per-stream thread ─────────────────────────────────────────
active_streams = {}   # streamId -> {'stop': Event}


def stream_worker(stream_id, rtsp_url):
    stop_event = active_streams[stream_id]['stop']
    log({'type': 'info', 'message': f'Stream worker started: {stream_id}'})
    enrolled_mtime = 0
    cap = None
    frame_idx = 0

    while not stop_event.is_set():
        # ── reconnect ──
        if cap is None or not cap.isOpened():
            if cap:
                cap.release()
            cap = cv2.VideoCapture(rtsp_url)
            if not cap.isOpened():
                log({'type': 'warning', 'message': f'[{stream_id[:8]}] RTSP open failed; retry 2s'})
                time.sleep(2)
                continue

        ret, frame = cap.read()
        if not ret:
            cap.release(); cap = None; time.sleep(1); continue

        frame_idx += 1
        if frame_idx % FRAME_SKIP != 0:
            continue

        # ── auto-retrain on enrollment change ──
        if os.path.isdir(ENROLLMENT_DIR):
            mtime = os.path.getmtime(ENROLLMENT_DIR)
            if mtime != enrolled_mtime:
                enrolled_mtime = mtime
                train_recognizer()

        # ── detect ──
        h, w = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        try:
            with detector_lock:
                result = shared_detector.detect(mp_img)
        except Exception as ex:
            log({'type': 'warning', 'message': f'detect error: {ex}'}); continue

        detections = []
        if result.detections:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            for d in result.detections:
                bb   = d.bounding_box
                conf = d.categories[0].score if d.categories else 0.0
                name = None
                with recognizer_lock:
                    if recognizer_ready:
                        x = max(0, bb.origin_x); y = max(0, bb.origin_y)
                        fw = min(bb.width, w - x); fh = min(bb.height, h - y)
                        crop = gray[y:y+fh, x:x+fw]
                        if crop.size > 0:
                            crop = cv2.resize(crop, (120, 120))
                            label, dist = recognizer.predict(crop)
                            if dist < RECOGNITION_THRESHOLD:
                                name = names_map.get(label)
                detections.append({
                    'x': bb.origin_x / w, 'y': bb.origin_y / h,
                    'w': bb.width / w,    'h': bb.height / h,
                    'confidence': float(conf), 'label': 'face', 'name': name,
                })

        log({'type': 'detections', 'streamId': stream_id, 'detections': detections})

    if cap:
        cap.release()
    log({'type': 'info', 'message': f'Stream worker stopped: {stream_id}'})


# ── Main: read commands from stdin ────────────────────────────
def main():
    train_recognizer()
    log({'type': 'ready', 'message': 'Multi-stream worker ready'})

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            cmd = json.loads(raw)
        except json.JSONDecodeError:
            continue

        action = cmd.get('cmd')

        if action == 'add':
            sid = cmd['streamId']
            url = cmd['rtspUrl']
            if sid not in active_streams:
                stop_ev = threading.Event()
                active_streams[sid] = {'stop': stop_ev}
                t = threading.Thread(target=stream_worker, args=(sid, url), daemon=True)
                t.start()
                active_streams[sid]['thread'] = t

        elif action == 'remove':
            sid = cmd.get('streamId')
            if sid in active_streams:
                active_streams[sid]['stop'].set()
                del active_streams[sid]

        elif action == 'quit':
            for info in active_streams.values():
                info['stop'].set()
            break


if __name__ == '__main__':
    main()
