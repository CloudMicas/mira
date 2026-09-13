import React from 'react';
import BackgroundLayer from './BackgroundLayer';
import CharacterLayer from './CharacterLayer';
import MediaLayer from './MediaLayer';
import SubtitleBar from '../SubtitleBar';
import StatusBadge from '../StatusBadge';
import { useCharacterStore } from '../../store/characterStore';

interface SceneContainerProps {
  children?: React.ReactNode;
}

const SceneContainer: React.FC<SceneContainerProps> = ({ children }) => {
  const camera = useCharacterStore((s) => s.camera);
  return (
    <div className="scene-container">
      <BackgroundLayer />
      <div className={`camera-wrapper camera-${camera}`} id="camera-wrapper">
        <CharacterLayer />
      </div>
      <MediaLayer />
      <SubtitleBar />
      <StatusBadge />
      {children}
    </div>
  );
};

export default SceneContainer;
