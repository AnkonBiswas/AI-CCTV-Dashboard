"""Download a pretrained YOLOv8 fire/smoke detection model.

Replaces the placeholder at face-ai/fire_model.pt with a real ~6MB YOLOv8n
model trained on fire + smoke classes. After this script finishes, restart
the backend so detect.py picks up the model on its next boot (it auto-loads
any fire_model.pt > 1MB).

Source: github.com/luminous0219/fire-and-smoke-detection-yolov8
        (YOLOv8n, 150 epochs, classes: fire, smoke).
"""
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DEST = os.path.join(HERE, 'fire_model.pt')
URL = ('https://raw.githubusercontent.com/luminous0219/'
       'fire-and-smoke-detection-yolov8/main/weights/best.pt')


def _progress(block_num, block_size, total_size):
    downloaded = block_num * block_size
    if total_size > 0:
        pct = min(100.0, downloaded * 100.0 / total_size)
        sys.stdout.write(f'\r  {downloaded/1024/1024:6.2f} / '
                         f'{total_size/1024/1024:.2f} MB ({pct:5.1f}%)')
    else:
        sys.stdout.write(f'\r  {downloaded/1024/1024:6.2f} MB')
    sys.stdout.flush()


def main():
    existing = os.path.getsize(DEST) if os.path.exists(DEST) else 0
    if existing > 1_000_000:
        print(f'fire_model.pt already present ({existing/1024/1024:.2f} MB).')
        print('Delete it first if you want to re-download.')
        return

    print(f'Downloading fire/smoke YOLOv8n')
    print(f'  from: {URL}')
    print(f'  to:   {DEST}')
    tmp = DEST + '.part'
    if os.path.exists(tmp):
        os.remove(tmp)
    try:
        urllib.request.urlretrieve(URL, tmp, reporthook=_progress)
        print()
    except Exception as ex:
        print(f'\nDownload failed: {ex}')
        if os.path.exists(tmp):
            os.remove(tmp)
        sys.exit(1)

    size = os.path.getsize(tmp)
    if size < 1_000_000:
        print(f'Downloaded file too small ({size} bytes) — aborting.')
        os.remove(tmp)
        sys.exit(1)

    # Validate by loading via ultralytics; catches truncated/corrupt downloads
    # before we overwrite the existing file.
    try:
        from ultralytics import YOLO
        m = YOLO(tmp)
        print(f'Validated. Classes: {m.names}')
    except Exception as ex:
        print(f'ultralytics rejected the file: {ex}')
        os.remove(tmp)
        sys.exit(1)

    os.replace(tmp, DEST)
    print(f'Saved {DEST} ({size/1024/1024:.2f} MB).')
    print('Restart the backend so the AI worker reloads with the new model.')


if __name__ == '__main__':
    main()
