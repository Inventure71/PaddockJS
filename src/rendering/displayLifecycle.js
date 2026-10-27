// Display objects own their children, while simulator textures remain shared.
export function destroyDisplayChildren(container) {
  container?.removeChildren?.().forEach((child) => {
    child.destroy?.({ children: true, texture: false, textureSource: false });
  });
}
