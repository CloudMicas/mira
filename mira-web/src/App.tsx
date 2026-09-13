import React, { useEffect } from 'react';
import SceneContainer from './components/Scene/SceneContainer';
import InteractionLayer from './components/InteractionLayer';
import { useInteraction } from './hooks/useInteraction';

export default function App() {
  const {
    init,
    startSpeaking,
    stopSpeaking,
    sendText,
    doInterrupt,
    destroy,
    wsStatus,
    isSupported,
  } = useInteraction();

  // 初始化 WS 连接
  useEffect(() => {
    init();
    return () => destroy();
  }, [init, destroy]);

  // 开场：等待 WS 连接后自动触发对话
  useEffect(() => {
    if (wsStatus !== 'connected') return;
    // 连接成功后，发送一个开场白（文字输入模式）
    const timer = setTimeout(() => {
      sendText('你好');
    }, 1000);
    return () => clearTimeout(timer);
  }, [wsStatus, sendText]);

  return (
    <SceneContainer>
      <InteractionLayer
        onSendText={sendText}
        onPressStart={startSpeaking}
        onPressEnd={stopSpeaking}
        onInterrupt={doInterrupt}
        wsStatus={wsStatus}
        micSupported={isSupported}
      />
    </SceneContainer>
  );
}
