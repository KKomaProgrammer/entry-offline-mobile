# Entry Offline Mobile

[entrylabs/entry-offline](https://github.com/entrylabs/entry-offline)의 편집기와 오프라인 오브젝트·그림·소리 자료를 Android 앱에 포함하고, GitHub Actions에서 설치 가능한 APK를 만드는 비공식 호환 저장소입니다.

Electron은 Android에서 직접 실행할 수 없으므로 Electron 창과 Node.js 파일 처리를 Capacitor WebView 및 Android 파일 저장 브리지로 교체했습니다. 편집기와 리소스는 고정된 원본 `entry-offline` 2.1.35 소스에서 빌드합니다.

## APK 받기

1. **Releases**에서 `Entry-Offline-Mobile.apk`를 받습니다.
2. 또는 **Actions → Build Android APK → Run workflow**를 실행합니다.
3. 완료된 실행의 `Entry-Offline-Mobile-APK` artifact를 내려받습니다.

`main`에 푸시하면 APK를 다시 만들고 `mobile-latest` Release를 갱신합니다. 수동 실행 시 `upstream_ref`에 다른 Entry Offline 커밋·태그·브랜치를 입력할 수 있습니다.

## 지원 기능

- 일반형·교과형 Entry Offline 편집기와 엔트리파이선
- 앱에 포함된 오브젝트·그림·소리 자료
- 자동 임시 저장(LocalStorage)
- Android 파일 선택기를 통한 `.ent` 불러오기 및 저장
- 사용자 그림·소리와 CSV 데이터 테이블 가져오기
- 카메라·마이크를 사용하는 웹 기반 블록
- 가로 화면과 터치 조작

## Android 제한 사항

- 시리얼 포트 및 Entry Hardware 프로그램 연결은 비활성화됩니다.
- Electron/FFmpeg 전용 기능인 사운드 MP3 재인코딩, Arduino 소스 처리, 블록 이미지 폴더 일괄 저장은 제외됩니다.
- `.eo` 오브젝트 파일과 Excel 가져오기는 제외됩니다(CSV는 지원).
- 웹 API 기반 AI·번역 기능은 인터넷 연결이 필요할 수 있습니다.

원본 자료를 모두 APK에 넣으므로 파일 용량과 최초 Actions 빌드 시간이 큽니다.

## 로컬 빌드

Node.js 22, Java 21, Android SDK 36이 필요합니다.

```bash
git clone https://github.com/entrylabs/entry-offline.git .upstream
git clone --depth 1 --branch dist/offline_v2.1.35 https://github.com/entrylabs/entryjs.git .vendor/entry-js
git clone --depth 1 --branch dist/20231026 https://github.com/entrylabs/entry-tool.git .vendor/entry-tool
(cd .upstream && npm install --legacy-peer-deps --ignore-scripts)
npm ci
npm run build:web -- .upstream .vendor/entry-js .vendor/entry-tool
npm run android:sync
(cd android && ./gradlew assembleDebug)
```

## 라이선스

- Entry Offline: Copyright (c) NAVER Connect Foundation, Apache License 2.0
- EntryJS 및 포함 라이브러리: 각 원본 저장소와 패키지의 라이선스
- Android 이식 코드: Apache License 2.0
