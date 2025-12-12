# DrowsyDetect

A real-time fatigue detection web app based on computer vision.

使用笔记本摄像头 + MediaPipe FaceMesh 进行实时疲劳（闭眼）检测。通过计算眼睛纵横比（EAR）并在低于阈值、连续一定帧数后触发“疲劳预警”。
<img width="1024" alt="image" src="https://github.com/user-attachments/assets/fea022d0-5adc-4814-bda6-aa9f1e95a850" />

## 运行

1. 直接双击打开 `index.html`（推荐用本地 HTTP 服务器以避免权限问题）。
2. 浏览器会请求摄像头权限，允许即可。

如果需要本地服务器（任选一种）：

- Python 3: `python -m http.server 8000`
- Node: `npx http-server -p 8000 --cors`
- VSCode Live Server 插件

然后访问 `http://localhost:8000/`。

## 使用

- 启动/停止摄像头按钮控制推理。
- “叠加关键点”用于开关可视化关键点。
- 三个滑块：
  - 置信阈值：FaceMesh 检测/追踪置信度。
  - 疲劳阈值 (EAR)：越低越容易判定为闭眼。
  - 持续帧数：低于阈值的连续帧数量达到该值即告警。

## 实现细节

- 使用 CDN 引入 `@mediapipe/face_mesh` 与 `camera_utils`、`drawing_utils`。
- 在 `main.js` 中：
  - 通过 `Camera` 从 `<video>` 获取帧并发送至 FaceMesh。
  - 基于 landmarks 计算左右眼 EAR，取平均。
  - 连续低于阈值计数以降低偶发误检。

## 注意

- EAR 指标与设备、角度、光照有关，建议根据实际情况微调阈值（默认 0.23）。
- 请保证正脸、光照均匀以获得更稳定的检测效果。
- 本项目为演示用途，非医疗或安全等级产品。

## 许可

MIT
