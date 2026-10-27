function clonePointLike(point) {
  if (!point) return point;
  return { ...point };
}

function clonePointArray(points) {
  return Array.isArray(points) ? points.map(clonePointLike) : points;
}

export function clonePitLaneModel(pitLane) {
  if (!pitLane) return pitLane;
  return {
    ...pitLane,
    entry: pitLane.entry ? {
      ...pitLane.entry,
      trackPoint: clonePointLike(pitLane.entry.trackPoint),
      edgePoint: clonePointLike(pitLane.entry.edgePoint),
      trackConnectPoint: clonePointLike(pitLane.entry.trackConnectPoint),
      lanePoint: clonePointLike(pitLane.entry.lanePoint),
      roadCenterline: clonePointArray(pitLane.entry.roadCenterline),
      connector: clonePointArray(pitLane.entry.connector),
    } : pitLane.entry,
    exit: pitLane.exit ? {
      ...pitLane.exit,
      trackPoint: clonePointLike(pitLane.exit.trackPoint),
      edgePoint: clonePointLike(pitLane.exit.edgePoint),
      trackConnectPoint: clonePointLike(pitLane.exit.trackConnectPoint),
      lanePoint: clonePointLike(pitLane.exit.lanePoint),
      roadCenterline: clonePointArray(pitLane.exit.roadCenterline),
      connector: clonePointArray(pitLane.exit.connector),
    } : pitLane.exit,
    mainLane: pitLane.mainLane ? {
      ...pitLane.mainLane,
      start: clonePointLike(pitLane.mainLane.start),
      end: clonePointLike(pitLane.mainLane.end),
      points: clonePointArray(pitLane.mainLane.points),
    } : pitLane.mainLane,
    workingLane: pitLane.workingLane ? {
      ...pitLane.workingLane,
      start: clonePointLike(pitLane.workingLane.start),
      end: clonePointLike(pitLane.workingLane.end),
      points: clonePointArray(pitLane.workingLane.points),
    } : pitLane.workingLane,
    fastLane: pitLane.fastLane ? { ...pitLane.fastLane } : pitLane.fastLane,
    serviceNormal: clonePointLike(pitLane.serviceNormal),
    boxes: Array.isArray(pitLane.boxes)
      ? pitLane.boxes.map((box) => ({
        ...box,
        laneTarget: clonePointLike(box.laneTarget),
        center: clonePointLike(box.center),
        corners: clonePointArray(box.corners),
      }))
      : pitLane.boxes,
    serviceAreas: Array.isArray(pitLane.serviceAreas)
      ? pitLane.serviceAreas.map((area) => ({
        ...area,
        laneTarget: clonePointLike(area.laneTarget),
        center: clonePointLike(area.center),
        queuePoint: clonePointLike(area.queuePoint),
        corners: clonePointArray(area.corners),
        queueCorners: clonePointArray(area.queueCorners),
        garageBoxIds: [...(area.garageBoxIds ?? [])],
        pitCrew: area.pitCrew ? { ...area.pitCrew } : area.pitCrew,
      }))
      : pitLane.serviceAreas,
    teams: Array.isArray(pitLane.teams)
      ? pitLane.teams.map((team) => ({ ...team, boxIds: [...(team.boxIds ?? [])], pitCrew: team.pitCrew ? { ...team.pitCrew } : team.pitCrew }))
      : pitLane.teams,
  };
}
