(function exposeLiveStageL1(root) {
  const REQUIRED = Object.freeze(['left_shoulder','right_shoulder','left_elbow','right_elbow','left_wrist','right_wrist','left_hip','right_hip','left_knee','right_knee','left_ankle','right_ankle']);
  const OPTIONAL = Object.freeze(['left_heel','right_heel','left_foot_index','right_foot_index']);
  const clamp = value => Math.max(0, Math.min(1, value));
  const median = values => { if (!values.length) return null; const sorted = [...values].sort((a,b)=>a-b), middle = Math.floor(sorted.length/2); return sorted.length%2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2; };
  const confidence = point => clamp(point?.visibility ?? point?.presence ?? 0);
  const midpoint = (a,b) => a&&b ? {x:(a.x+b.x)/2,y:(a.y+b.y)/2} : null;

  function poseNormalization(rawPose) {
    const points = rawPose.landmarks, shoulder = midpoint(points.left_shoulder,points.right_shoulder), hip = midpoint(points.left_hip,points.right_hip), ankle = midpoint(points.left_ankle,points.right_ankle);
    if (!shoulder || !hip || !ankle) return null;
    const top = shoulder, bottom = ankle, dx=bottom.x-top.x,dy=bottom.y-top.y,length=Math.hypot(dx,dy); if(length<.2)return null;
    const ux=dx/length,uy=dy/length;
    return point=>{const rx=point.x-top.x,ry=point.y-top.y;return{x_body_norm:.5+(rx*uy-ry*ux)/length,y_body_norm:(rx*ux+ry*uy)/length,basis:'pose shoulder-to-ankle fallback'}};
  }

  function normalizedPoint(rawPose, stage2, point) {
    if (!point) return null;
    if (stage2?.bodyAxis) {
      const transform=root.tailorScanStage2.createNormalization(stage2.bodyAxis), result=transform.point({x:point.x*rawPose.image_width,y:point.y*rawPose.image_height},rawPose.image_width,rawPose.image_height);
      return {x_body_norm:result.x_body_norm,y_body_norm:result.y_body_norm,basis:'Stage 2 head-to-floor body axis'};
    }
    return poseNormalization(rawPose)?.(point)||null;
  }

  function uprightness(rawPose) {
    const shoulder=midpoint(rawPose.landmarks.left_shoulder,rawPose.landmarks.right_shoulder),hip=midpoint(rawPose.landmarks.left_hip,rawPose.landmarks.right_hip),ankle=midpoint(rawPose.landmarks.left_ankle,rawPose.landmarks.right_ankle);if(!shoulder||!hip||!ankle)return 0;
    const angle=Math.abs(Math.atan2(ankle.x-shoulder.x,ankle.y-shoulder.y)*180/Math.PI);return clamp(1-angle/22);
  }

  function motionScore(session, normalized) {
    const distances=[];
    for(const [name,point] of Object.entries(normalized)){const prior=session.landmarks[name]?.observations?.at(-1);if(prior&&point)distances.push(Math.hypot(point.x_body_norm-prior.x_body_norm,point.y_body_norm-prior.y_body_norm));}
    return distances.length?clamp(1-median(distances)/.055):.65;
  }

  function scoreFrame(session, {timestamp,rawPose,stage2=null,quality={},segmentation={}}) {
    const normalized={},landmark_quality={};
    for(const name of [...REQUIRED,...OPTIONAL]){const point=rawPose.landmarks[name],conf=confidence(point),norm=normalizedPoint(rawPose,stage2,point),available=Boolean(point&&norm),usable=available&&conf>=session.config.minimumLandmarkConfidence;normalized[name]=norm;landmark_quality[name]={available,confidence:conf,usable};}
    const requiredQuality=REQUIRED.map(name=>landmark_quality[name]),poseVisibility=requiredQuality.reduce((sum,item)=>sum+item.confidence,0)/REQUIRED.length,completeness=requiredQuality.filter(item=>item.available).length/REQUIRED.length,coverage=clamp(segmentation.boundingBox?.height??quality.bodyVisibility??0),segmentationQuality=clamp(quality.segmentationQuality??segmentation.confidence??0),upright=uprightness(rawPose),motion=motionScore(session,normalized),overall=clamp(.25*poseVisibility+.2*completeness+.2*coverage+.12*segmentationQuality+.1*upright+.13*motion),usableCount=Object.values(landmark_quality).filter(item=>item.usable).length,reasons=[];
    if(coverage<.45)reasons.push('BODY_COVERAGE_LOW');if(poseVisibility<.4)reasons.push('POSE_VISIBILITY_LOW');if(motion<.35)reasons.push('MOTION_HIGH');if(segmentationQuality<.4)reasons.push('SEGMENTATION_WEAK');
    return{timestamp,pose_visibility_score:poseVisibility,landmark_completeness_score:completeness,body_coverage_score:coverage,segmentation_quality_score:segmentationQuality,uprightness_score:upright,motion_stability_score:motion,overall_frame_score:overall,retained:overall>=session.config.minimumFrameScore&&usableCount>=session.config.minimumUsableLandmarks,ignored_for_aggregation:false,reasons,landmark_quality,normalized};
  }

  function createSession(options={}) {
    const config={frameRate:options.frameRate??7,maxFrames:options.maxFrames??18,maxObservationsPerLandmark:options.maxObservationsPerLandmark??24,minimumFrameScore:options.minimumFrameScore??.43,minimumLandmarkConfidence:options.minimumLandmarkConfidence??.35,minimumUsableLandmarks:options.minimumUsableLandmarks??5,minimumRetainedFrames:options.minimumRetainedFrames??8,minimumObservations:options.minimumObservations??5,minimumStability:options.minimumStability??.62,minimumDurationMs:options.minimumDurationMs??2500,timeoutMs:options.timeoutMs??12000};
    return{config,startTime:options.startTime??0,endTime:null,framesSeen:0,framesAnalyzed:0,framesRetained:0,framesIgnored:0,frameBuffer:[],frameQualityHistory:[],landmarks:Object.fromEntries([...REQUIRED,...OPTIONAL].map(name=>[name,{observations:[]}]))};
  }

  function markFrameSeen(session){session.framesSeen+=1;}
  function ignoreFrame(session,timestamp,reason='FRAME_EVIDENCE_UNUSABLE'){session.framesAnalyzed+=1;session.framesIgnored+=1;session.frameQualityHistory.push({timestamp,overall_frame_score:0,retained:false,reasons:[reason]});if(session.frameQualityHistory.length>session.config.maxFrames*3)session.frameQualityHistory.shift();}
  function addFrame(session,input){session.framesAnalyzed+=1;const scored=scoreFrame(session,input),observations=[];
    for(const name of [...REQUIRED,...OPTIONAL]){const point=input.rawPose.landmarks[name],norm=scored.normalized[name],landmarkQuality=scored.landmark_quality[name];if(!landmarkQuality.usable||!norm)continue;const contributionQuality=clamp(.65*landmarkQuality.confidence+.35*scored.overall_frame_score);if(contributionQuality<.34)continue;observations.push(name);const entry={timestamp:input.timestamp,x_image_norm:point.x,y_image_norm:point.y,x_px:point.x*input.rawPose.image_width,y_px:point.y*input.rawPose.image_height,x_body_norm:norm.x_body_norm,y_body_norm:norm.y_body_norm,confidence:landmarkQuality.confidence,frame_score:scored.overall_frame_score,quality:contributionQuality,outlier:false};const buffer=session.landmarks[name].observations;buffer.push(entry);buffer.sort((a,b)=>b.quality-a.quality||a.timestamp-b.timestamp);if(buffer.length>session.config.maxObservationsPerLandmark)buffer.length=session.config.maxObservationsPerLandmark;}
    scored.retained=scored.retained||observations.length>=session.config.minimumUsableLandmarks;scored.ignored_for_aggregation=!scored.retained&&!observations.length;if(scored.retained){session.framesRetained+=1;session.frameBuffer.push({timestamp:input.timestamp,score:scored.overall_frame_score,landmarks:observations});session.frameBuffer.sort((a,b)=>b.score-a.score);if(session.frameBuffer.length>session.config.maxFrames)session.frameBuffer.length=session.config.maxFrames;}else session.framesIgnored+=1;
    session.frameQualityHistory.push({timestamp:scored.timestamp,overall_frame_score:scored.overall_frame_score,retained:scored.retained,reasons:scored.reasons});if(session.frameQualityHistory.length>session.config.maxFrames*3)session.frameQualityHistory.shift();return scored;}

  function stabilizeLandmark(observations,config={}){if(!observations.length)return{stabilized_position:null,observation_count:0,stability_score:0,confidence:0,outlier_count:0,observations:[]};const mx=median(observations.map(item=>item.x_body_norm)),my=median(observations.map(item=>item.y_body_norm)),distances=observations.map(item=>Math.hypot(item.x_body_norm-mx,item.y_body_norm-my)),md=median(distances),mad=median(distances.map(value=>Math.abs(value-md)))||0,threshold=Math.max(.012,md+3*1.4826*mad),marked=observations.map((item,index)=>({...item,outlier:distances[index]>threshold})),inliers=marked.filter(item=>!item.outlier),sx=median(inliers.map(item=>item.x_body_norm)),sy=median(inliers.map(item=>item.y_body_norm)),residuals=inliers.map(item=>Math.hypot(item.x_body_norm-sx,item.y_body_norm-sy)),spread=median(residuals)+(median(residuals.map(value=>Math.abs(value-median(residuals)))))||0,stability=clamp(1-spread/.045),countScore=clamp(inliers.length/(config.minimumObservations??5)),evidence=mean(inliers.map(item=>item.confidence)),confidenceScore=clamp(.5*stability+.3*evidence+.2*countScore);return{stabilized_position:{x_body_norm:sx,y_body_norm:sy},observation_count:inliers.length,stability_score:stability,confidence:confidenceScore,outlier_count:marked.length-inliers.length,observations:marked};}
  function mean(values){return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0;}

  function summarize(session,endTime,requestedFallback=false){session.endTime=endTime;const landmarks={},unstable=[];for(const name of [...REQUIRED,...OPTIONAL]){landmarks[name]=stabilizeLandmark(session.landmarks[name].observations,session.config);const result=landmarks[name];if(REQUIRED.includes(name)&&(result.observation_count<session.config.minimumObservations||result.stability_score<session.config.minimumStability))unstable.push(name);}const stableCount=REQUIRED.length-unstable.length,duration=Math.max(0,endTime-session.startTime),coverage=mean(session.frameQualityHistory.map(frame=>frame.overall_frame_score)),sufficient=duration>=session.config.minimumDurationMs&&session.framesRetained>=session.config.minimumRetainedFrames&&stableCount>=Math.ceil(REQUIRED.length*.75),status=sufficient?'sufficient':requestedFallback?'fallback_to_photo_mode':session.framesAnalyzed>=session.config.minimumRetainedFrames||duration>=session.config.timeoutMs?'fallback_to_photo_mode':'insufficient';let dominantCause=null;if(!sufficient){const ankleWeak=['left_ankle','right_ankle'].some(name=>unstable.includes(name));dominantCause=ankleWeak?'ankles frequently outside frame':coverage<.42?'not enough full-body coverage':stableCount<REQUIRED.length*.5?'pose detection unstable':'not enough stable observations';}
    return{session:{status,duration_ms:duration,frames_seen:session.framesSeen,frames_analyzed:session.framesAnalyzed,frames_retained:session.framesRetained,frames_ignored:session.framesIgnored},frame_quality_summary:{mean_overall_score:coverage,retained_ratio:session.framesAnalyzed?session.framesRetained/session.framesAnalyzed:0},landmarks,stable_landmarks:stableCount,unstable_landmarks:unstable,warnings:dominantCause?[dominantCause]:[],measurements:null};}
  function progress(session){const summary=summarize({...session,endTime:null},Math.max(session.startTime,session.frameQualityHistory.at(-1)?.timestamp??session.startTime));return{person_visible:session.framesRetained?'Good':'Waiting',pose_quality:summary.frame_quality_summary.mean_overall_score,stable_landmarks:summary.stable_landmarks,total_landmarks:REQUIRED.length,capture_confidence:clamp(.55*(summary.stable_landmarks/REQUIRED.length)+.45*summary.frame_quality_summary.mean_overall_score)};}
  root.tailorScanLiveL1=Object.freeze({REQUIRED,OPTIONAL,createSession,markFrameSeen,ignoreFrame,scoreFrame,addFrame,stabilizeLandmark,summarize,progress});
})(typeof window==='undefined'?globalThis:window);
