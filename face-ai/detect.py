import sys, os, json, time, threading, re, collections
import cv2, numpy as np, mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
from ultralytics import YOLO

HERE = os.path.dirname(os.path.abspath(__file__))
ENROLLMENT_DIR = os.path.join(HERE, 'enrollments')
FACE_MODEL_PATH = os.path.join(HERE, 'blaze_face_short_range.tflite')
YOLO_MODEL_PATH = os.path.join(HERE, 'yolov8n.pt') # Standard nano model
FIRE_MODEL_PATH = os.path.join(HERE, 'fire_model.pt') # Optional custom model

FRAME_SKIP = 2               # process every Nth frame per stream
RECOGNITION_THRESHOLD = 115

# ── Download models if needed ──────────────────────────────────
if not os.path.exists(FACE_MODEL_PATH):
    import urllib.request
    log({'type': 'info', 'message': 'Downloading face model...'})
    urllib.request.urlretrieve(
        'https://storage.googleapis.com/mediapipe-models/face_detector/'
        'blaze_face_short_range/float16/latest/blaze_face_short_range.tflite',
        FACE_MODEL_PATH)

# ── AI Models ────────────────────────────────────────────────
# MediaPipe Face Detector
face_base_options = mp_python.BaseOptions(model_asset_path=FACE_MODEL_PATH)
face_detector_options = mp_vision.FaceDetectorOptions(
    base_options=face_base_options,
    min_detection_confidence=0.5,
    min_suppression_threshold=0.3,
)
shared_face_detector = mp_vision.FaceDetector.create_from_options(face_detector_options)
face_detector_lock = threading.Lock()

# YOLOv8 for General Objects & Incidents
# Standard YOLOv8 detects 'person' (ID 0). Fire/Fight usually need custom models.
yolo_model = YOLO(YOLO_MODEL_PATH)
fire_model = None
if os.path.exists(FIRE_MODEL_PATH):
    try:
        fire_model = YOLO(FIRE_MODEL_PATH)
    except: pass

yolo_lock = threading.Lock()

# LBPH recognizer
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
        if img_bgr is None: continue
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        rgb  = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        stem = os.path.splitext(fname)[0]
        base = re.sub(r'_\d+$', '', stem)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        with face_detector_lock:
            result = shared_face_detector.detect(mp_img)
        if result.detections:
            bb = result.detections[0].bounding_box
            ih, iw = gray.shape
            x = max(0, bb.origin_x); y = max(0, bb.origin_y)
            w = min(bb.width, iw - x); h = min(bb.height, ih - y)
            crop = gray[y:y+h, x:x+w]
            if crop.size > 0:
                faces.append(cv2.resize(crop, (120, 120)))
                labels.append(get_label(base))
        else:
            log({'type': 'warning', 'message': f'No face in enrollment: {fname}'})

    with recognizer_lock:
        if faces:
            recognizer.train(faces, np.array(labels))
            names_map = {v: k.replace('_', ' ') for k, v in name_to_label.items()}
            recognizer_ready = True
        else:
            recognizer_ready = False


# ── Per-stream thread ─────────────────────────────────────────
active_streams = {}

def stream_worker(stream_id, rtsp_url):
    stop_event = active_streams[stream_id]['stop']
    log({'type': 'info', 'message': f'Stream worker started: {stream_id}'})
    enrolled_mtime = 0
    cap = None
    frame_idx = 0

    # For incident heuristics (e.g. fight)
    person_history = collections.deque(maxlen=10) # Track person counts/locations

    while not stop_event.is_set():
        if cap is None or not cap.isOpened():
            if cap: cap.release()
            cap = cv2.VideoCapture(rtsp_url)
            if not cap.isOpened():
                time.sleep(2); continue

        ret, frame = cap.read()
        if not ret:
            cap.release(); cap = None; time.sleep(1); continue

        frame_idx += 1
        if frame_idx % FRAME_SKIP != 0: continue

        # Auto-retrain
        if os.path.isdir(ENROLLMENT_DIR):
            try:
                mtime = os.path.getmtime(ENROLLMENT_DIR)
                if mtime != enrolled_mtime:
                    enrolled_mtime = mtime
                    train_recognizer()
            except: pass

        h, w = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        # 1. Face Detection & Recognition
        detections = []
        try:
            with face_detector_lock:
                result = shared_face_detector.detect(mp_img)
            if result.detections:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                for d in result.detections:
                    bb = d.bounding_box
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
                        'confidence': float(d.categories[0].score if d.categories else 0),
                        'label': 'face', 'name': name,
                    })
        except Exception as ex:
            log({'type': 'warning', 'message': f'Face detect error: {ex}'})

        # 2. YOLO Incident Detection (General Objects + Heuristics)
        incidents = []
        try:
            with yolo_lock:
                # Run YOLOv8 on current frame
                yolo_results = yolo_model(frame, verbose=False)[0]
                
                people = []
                for box in yolo_results.boxes:
                    cls_id = int(box.cls[0])
                    conf = float(box.conf[0])
                    if conf < 0.3: continue
                    
                    label = yolo_model.names[cls_id]
                    bx = box.xyxyn[0].tolist() # [x1, y1, x2, y2]
                    
                    if label == 'person':
                        people.append(bx)
                        detections.append({
                            'x': bx[0], 'y': bx[1], 'w': bx[2]-bx[0], 'h': bx[3]-bx[1],
                            'confidence': conf, 'label': 'person'
                        })
                    elif label in ['fire', 'smoke']: # In case custom model is used or standard detects them
                        incidents.append({'type': 'fire', 'confidence': conf, 'box': bx})

                # Basic Fight Heuristic: Multiple people overlapping + high motion (simplified)
                if len(people) >= 2:
                    # Check for significant overlap between any two people
                    for i in range(len(people)):
                        for j in range(i + 1, len(people)):
                            p1, p2 = people[i], people[j]
                            # Intersection
                            ix1 = max(p1[0], p2[0]); iy1 = max(p1[1], p2[1])
                            ix2 = min(p1[2], p2[2]); iy2 = min(p1[3], p2[3])
                            if ix2 > ix1 and iy2 > iy1:
                                area = (ix2 - ix1) * (iy2 - iy1)
                                if area > 0.05: # Threshold for "fighting" proximity
                                    incidents.append({'type': 'fighting', 'confidence': 0.7, 'box': [ix1, iy1, ix2, iy2]})

                # If we have a dedicated fire model, run it
                if fire_model:
                    f_results = fire_model(frame, verbose=False)[0]
                    for box in f_results.boxes:
                        if float(box.conf[0]) > 0.4:
                            bx = box.xyxyn[0].tolist()
                            incidents.append({'type': 'fire', 'confidence': float(box.conf[0]), 'box': bx})

        except Exception as ex:
            log({'type': 'warning', 'message': f'YOLO error: {ex}'})

        log({'type': 'detections', 'streamId': stream_id, 'detections': detections, 'incidents': incidents})

    if cap: cap.release()
    log({'type': 'info', 'message': f'Stream worker stopped: {stream_id}'})


def main():
    train_recognizer()
    log({'type': 'ready', 'message': 'Multi-stream worker ready with YOLO incident detection'})

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw: continue
        try:
            cmd = json.loads(raw)
        except: continue

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
            for info in active_streams.values(): info['stop'].set()
            break

if __name__ == '__main__':
    main()
