import {
  Component,
  Suspense,
  lazy,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { ErrorInfo, ReactNode } from "react";
import {
  buildInversionLabPanelData,
  buildObserverViewPanelData,
  buildProfileVisibilityPanelData,
  buildRayBundlePanelData,
  buildRouteMapPanelData,
  buildSceneViewModel,
  buildSkyWrapPanelData,
  buildSweepChartData,
  formatSweepParameterValue,
  getTerrainProfileByPresetId,
  solveVisibility,
} from "./domain";
import { hydrateStateFromSearch, appReducer, serializeStateToSearch } from "./state/appState";
import type {
  FocusedModel,
  InversionLabPanelData,
  ObserverViewPanelData,
  ProfileVisibilityPanelData,
  RayBundlePanelData,
  RouteMapPanelData,
  SceneViewModel,
  SkyWrapPanelData,
  SweepChartData,
} from "./domain";
import { AnalysisTabs } from "./ui/components/AnalysisTabs";
import { ControlsPanel } from "./ui/components/ControlsPanel";
import { PresentationToolbar } from "./ui/components/PresentationToolbar";
import { RightPanel } from "./ui/components/RightPanel";
import { SceneLegendOverlay } from "./ui/components/SceneLegendOverlay";
import { SceneSvg } from "./ui/components/SceneSvg";
import { SceneToolbar } from "./ui/components/SceneToolbar";
import { TopNav } from "./ui/components/TopNav";
import { AppFooter } from "./ui/components/AppFooter";
import { downloadSvgAsPng } from "./ui/exportSvg";
import { downloadHtmlReport, downloadJson } from "./ui/exportReport";
import { getModelLabel, t } from "./i18n";
import { Analytics } from "@vercel/analytics/react";

const RayBundleView = lazy(() =>
  import("./ui/components/RayBundleView").then((module) => ({
    default: module.RayBundleView,
  })),
);
const ObserverView = lazy(() =>
  import("./ui/components/ObserverView").then((module) => ({
    default: module.ObserverView,
  })),
);
const ProfileVisibilityView = lazy(() =>
  import("./ui/components/ProfileVisibilityView").then((module) => ({
    default: module.ProfileVisibilityView,
  })),
);
const RouteMapView = lazy(() =>
  import("./ui/components/RouteMapView").then((module) => ({
    default: module.RouteMapView,
  })),
);
const SkyWrapView = lazy(() =>
  import("./ui/components/SkyWrapView").then((module) => ({
    default: module.SkyWrapView,
  })),
);
const InversionLabView = lazy(() =>
  import("./ui/components/InversionLabView").then((module) => ({
    default: module.InversionLabView,
  })),
);
const RefractionLabView = lazy(() =>
  import("./ui/components/RefractionLabView").then((module) => ({
    default: module.RefractionLabView,
  })),
);
const SweepChart = lazy(() =>
  import("./ui/components/SweepChart").then((module) => ({
    default: module.SweepChart,
  })),
);

function getSceneFilename(analysisTab: string, viewMode: string): string {
  return `geodesy-${analysisTab}-${viewMode}.png`;
}

function getExportBasename(analysisTab: string, viewMode: string) {
  return `geodesy-${analysisTab}-${viewMode}`;
}

function getAnalysisViewportFamily(analysisTab: string) {
  switch (analysisTab) {
    case "sky-wrap":
    case "inversion-lab":
      return "global";
    case "route-map":
      return "map";
    case "sweep":
      return "chart";
    case "refraction-lab":
      return "refraction";
    case "ray-bundle":
    case "observer-view":
    case "profile-visibility":
    case "cross-section":
    default:
      return "local";
  }
}

function getAnalysisTabLabel(language: string, analysisTab: string) {
  switch (analysisTab) {
    case "ray-bundle":
      return t(language as Parameters<typeof t>[0], "rayBundle");
    case "observer-view":
      return t(language as Parameters<typeof t>[0], "observerView");
    case "profile-visibility":
      return t(language as Parameters<typeof t>[0], "profileVisibility");
    case "route-map":
      return t(language as Parameters<typeof t>[0], "routeMap");
    case "sky-wrap":
      return t(language as Parameters<typeof t>[0], "skyWrap");
    case "inversion-lab":
      return t(language as Parameters<typeof t>[0], "inversionLab");
    case "refraction-lab":
      return t(language as Parameters<typeof t>[0], "refractionLab");
    case "sweep":
      return t(language as Parameters<typeof t>[0], "sweep");
    case "cross-section":
    default:
      return t(language as Parameters<typeof t>[0], "crossSection");
  }
}

function AnalysisLoadingFallback({ message }: { message: string }) {
  return (
    <div className="scene-card__loading" role="status" aria-live="polite">
      <div className="scene-card__loading-card panel">
        <p className="scene-card__loading-title">{message}</p>
        <p className="scene-card__loading-body">
          Loading the analysis workspace and charting modules.
        </p>
      </div>
    </div>
  );
}

interface AnalysisErrorBoundaryProps {
  activeKey: string;
  children: ReactNode;
}

interface AnalysisErrorBoundaryState {
  hasError: boolean;
  message: string | null;
}

class AnalysisErrorBoundary extends Component<
  AnalysisErrorBoundaryProps,
  AnalysisErrorBoundaryState
> {
  state: AnalysisErrorBoundaryState = {
    hasError: false,
    message: null,
  };

  static getDerivedStateFromError(error: unknown): AnalysisErrorBoundaryState {
    return {
      hasError: true,
      message:
        error instanceof Error
          ? error.message
          : "The selected analysis view could not be rendered.",
    };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error("Geodesy analysis view failed", error, errorInfo);
  }

  componentDidUpdate(previousProps: AnalysisErrorBoundaryProps) {
    if (previousProps.activeKey !== this.props.activeKey && this.state.hasError) {
      this.setState({ hasError: false, message: null });
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="scene-card__loading scene-card__error" role="alert">
        <div className="scene-card__loading-card panel">
          <p className="scene-card__loading-title">This analysis view needs a reset.</p>
          <p className="scene-card__loading-body">
            One of the advanced modules failed to draw instead of taking down the whole lab.
            Try the button below, or switch tabs and come back.
          </p>
          {this.state.message ? (
            <p className="scene-card__error-detail">{this.state.message}</p>
          ) : null}
          <button
            className="action-button"
            type="button"
            onClick={() => this.setState({ hasError: false, message: null })}
          >
            Retry view
          </button>
        </div>
      </div>
    );
  }
}

function createEmptyBundlePanel(
  sceneKey: FocusedModel,
  title: string,
): RayBundlePanelData {
  return {
    sceneKey,
    title,
    subtitle: "",
    bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
    suggestedVerticalScale: 1,
    surfacePoints: [],
    targetStem: {
      base: { x: 0, y: 0 },
      top: { x: 0, y: 0 },
      visibleStart: { x: 0, y: 0 },
    },
    observerStem: {
      base: { x: 0, y: 0 },
      top: { x: 0, y: 0 },
    },
    traces: [],
    markers: [],
    samplePoints: [],
    stats: {
      visibleSamples: 0,
      blockedSamples: 0,
      visibilityFractionLabel: "0%",
      bundleSpanM: 0,
    },
  };
}

function createEmptyProfileVisibilityPanel(
  sceneKey: FocusedModel,
  title: string,
): ProfileVisibilityPanelData {
  return {
    sceneKey,
    title,
    subtitle: "",
    bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
    suggestedVerticalScale: 1,
    surfacePoints: [],
    profilePolyline: [],
    profileSegments: [],
    observerStem: {
      base: { x: 0, y: 0 },
      top: { x: 0, y: 0 },
    },
    traces: [],
    markers: [],
    samplePoints: [],
    stats: {
      visibleSamples: 0,
      blockedSamples: 0,
      visibilityFractionLabel: "0%",
      visibleSpanM: 0,
      sampleCount: 0,
      maxProfileHeightM: 0,
    },
  };
}

function createEmptyObserverViewPanel(
  sceneKey: FocusedModel,
  title: string,
): ObserverViewPanelData {
  return {
    sceneKey,
    title,
    subtitle: "",
    bounds: { minX: 0, maxX: 1, minY: -1, maxY: 1 },
    horizonElevationRad: 0,
    eyeLevelElevationRad: 0,
    visibleSilhouette: [],
    ghostSilhouette: [],
    samplePoints: [],
    markers: [],
    stats: {
      visibleSamples: 0,
      blockedSamples: 0,
      visibilityFractionLabel: "0%",
      horizonDipLabel: "0°",
      apparentProfileSpanM: 0,
      topVisibleElevationRad: null,
      topGhostElevationRad: 0,
    },
  };
}

function createEmptySweepChartData(): SweepChartData {
  return {
    parameter: "distance",
    metric: "hiddenHeight",
    range: {
      min: 0,
      max: 1,
      current: 0,
    },
    series: [],
    yMin: 0,
    yMax: 1,
  };
}

function createEmptySceneViewModel(
  sceneKey: FocusedModel,
  title: string,
): SceneViewModel {
  const origin = { x: 0, y: 0 };
  return {
    sceneKey,
    title,
    subtitle: "",
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    focusBounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    suggestedVerticalScale: 1,
    surfaceFill: {
      id: `${sceneKey}-surface-fill-empty`,
      points: [origin, origin, origin],
      fill: "transparent",
      opacity: 0,
    },
    surfaceLine: {
      id: `${sceneKey}-surface-line-empty`,
      featureId: "surface",
      color: "transparent",
      width: 0,
      points: [origin, origin],
    },
    observerStem: {
      id: `${sceneKey}-observer-stem-empty`,
      featureId: "observer-height",
      color: "transparent",
      width: 0,
      from: origin,
      to: origin,
    },
    targetStem: {
      id: `${sceneKey}-target-stem-empty`,
      featureId: "target-height",
      color: "transparent",
      width: 0,
      from: origin,
      to: origin,
    },
    markers: [],
    labels: [],
    lines: [],
    segments: [],
    annotations: [],
  };
}

function createEmptyRouteMapPanel(
  sceneKey: FocusedModel,
  title: string,
): RouteMapPanelData {
  return {
    sceneKey,
    title,
    subtitle: "",
    routeDistanceM: 0,
    bearingDeg: 0,
    routePoints: [],
    observerPoint: { latDeg: 0, lonDeg: 0 },
    targetPoint: { latDeg: 0, lonDeg: 0 },
    coordinatesEnabled: false,
    usesPreviewSeed: false,
  };
}

function createEmptySkyWrapPanel(
  sceneKey: FocusedModel,
  title: string,
): SkyWrapPanelData {
  return {
    sceneKey,
    title,
    subtitle: "",
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    domeRadius: 1,
    gridCurves: [],
    rayCurves: [],
    stats: {
      intrinsicLabel: "0 / R",
      atmosphereLabel: "0 / R",
      netLabel: "0 / R",
    },
  };
}

function createEmptyInversionLabPanel(
  sceneKey: FocusedModel,
  title: string,
): InversionLabPanelData {
  return {
    sceneKey,
    title,
    subtitle: "",
    inversionRadiusM: 1,
    globalView: {
      bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
      curves: [],
      markers: [],
    },
    localView: {
      bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
      curves: [],
      markers: [],
    },
    globalGuideRadiiM: [],
    coreRadiusM: 0.2,
    localVerticalScale: 1,
    audit: [],
  };
}

export default function App() {
  const [state, dispatch] = useReducer(
    appReducer,
    window.location.search,
    hydrateStateFromSearch,
  );
  const deferredState = useDeferredValue(state);
  const [message, setMessage] = useState<string | null>(null);
  const sceneHostRef = useRef<HTMLDivElement | null>(null);
  const [isSceneFullscreen, setIsSceneFullscreen] = useState(false);
  const [showLegendOverlay, setShowLegendOverlay] = useState(true);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight);
  const viewportFamilyRef = useRef(getAnalysisViewportFamily(state.analysisTab));

  const terrainObstructionProfile = useMemo(
    () =>
      state.useTerrainObstruction
        ? getTerrainProfileByPresetId(deferredState.scenario.presetId)
        : null,
    [deferredState.scenario.presetId, state.useTerrainObstruction],
  );

  useEffect(() => {
    const search = serializeStateToSearch(state);
    window.history.replaceState({}, "", `${window.location.pathname}${search}`);
  }, [state]);

  useEffect(() => {
    document.documentElement.lang = state.language;
  }, [state.language]);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsSceneFullscreen(document.fullscreenElement === sceneHostRef.current);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    function handleResize() {
      setWindowWidth(window.innerWidth);
      setWindowHeight(window.innerHeight);
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const nextFamily = getAnalysisViewportFamily(state.analysisTab);

    if (viewportFamilyRef.current !== nextFamily) {
      viewportFamilyRef.current = nextFamily;
      dispatch({ type: "resetViewport" });
    }
  }, [state.analysisTab]);

  const primaryResult = useMemo(
    () =>
      solveVisibility(
        deferredState.scenario,
        deferredState.primaryModel,
        terrainObstructionProfile,
      ),
    [deferredState, terrainObstructionProfile],
  );
  const comparisonResult = useMemo(
    () =>
      solveVisibility(
        deferredState.scenario,
        deferredState.comparisonModel,
        terrainObstructionProfile,
      ),
    [deferredState, terrainObstructionProfile],
  );

  const primaryScene = useMemo(
    () =>
      deferredState.analysisTab === "cross-section"
        ? buildSceneViewModel(
            primaryResult,
            t(deferredState.language, "primaryModelTitle"),
            "primary",
            deferredState.unitPreferences,
            deferredState.language,
          )
        : createEmptySceneViewModel("primary", t(deferredState.language, "primaryModelTitle")),
    [
      primaryResult,
      deferredState.analysisTab,
      deferredState.language,
      deferredState.unitPreferences,
    ],
  );
  const comparisonScene = useMemo(
    () =>
      deferredState.analysisTab === "cross-section"
        ? buildSceneViewModel(
            comparisonResult,
            t(deferredState.language, "comparisonModelTitle"),
            "comparison",
            deferredState.unitPreferences,
            deferredState.language,
          )
        : createEmptySceneViewModel(
            "comparison",
            t(deferredState.language, "comparisonModelTitle"),
          ),
    [
      comparisonResult,
      deferredState.analysisTab,
      deferredState.language,
      deferredState.unitPreferences,
    ],
  );
  const buildBothModelPanels = deferredState.viewMode === "compare";
  const buildPrimaryFocusedPanel =
    buildBothModelPanels || deferredState.focusedModel === "primary";
  const buildComparisonFocusedPanel =
    buildBothModelPanels || deferredState.focusedModel === "comparison";
  const buildsRayBundlePanels =
    deferredState.analysisTab === "ray-bundle" ||
    deferredState.analysisTab === "refraction-lab";
  const buildsObserverPanels =
    deferredState.analysisTab === "observer-view" ||
    deferredState.analysisTab === "refraction-lab";
  const primaryBundle = useMemo(
    () =>
      buildsRayBundlePanels && buildPrimaryFocusedPanel
        ? buildRayBundlePanelData(
            primaryResult,
            t(deferredState.language, "primaryModelTitle"),
            "primary",
          )
        : createEmptyBundlePanel("primary", t(deferredState.language, "primaryModelTitle")),
    [primaryResult, buildsRayBundlePanels, deferredState.language, buildPrimaryFocusedPanel],
  );
  const comparisonBundle = useMemo(
    () =>
      buildsRayBundlePanels && buildComparisonFocusedPanel
        ? buildRayBundlePanelData(
            comparisonResult,
            t(deferredState.language, "comparisonModelTitle"),
            "comparison",
          )
        : createEmptyBundlePanel(
            "comparison",
            t(deferredState.language, "comparisonModelTitle"),
          ),
    [
      comparisonResult,
      buildsRayBundlePanels,
      deferredState.language,
      buildComparisonFocusedPanel,
    ],
  );
  const primaryProfileVisibility = useMemo(
    () =>
      deferredState.analysisTab === "profile-visibility" && buildPrimaryFocusedPanel
        ? buildProfileVisibilityPanelData(
            primaryResult,
            t(deferredState.language, "primaryModelTitle"),
            "primary",
          )
        : createEmptyProfileVisibilityPanel(
            "primary",
            t(deferredState.language, "primaryModelTitle"),
          ),
    [primaryResult, deferredState.analysisTab, deferredState.language, buildPrimaryFocusedPanel],
  );
  const comparisonProfileVisibility = useMemo(
    () =>
      deferredState.analysisTab === "profile-visibility" && buildComparisonFocusedPanel
        ? buildProfileVisibilityPanelData(
            comparisonResult,
            t(deferredState.language, "comparisonModelTitle"),
            "comparison",
          )
        : createEmptyProfileVisibilityPanel(
            "comparison",
            t(deferredState.language, "comparisonModelTitle"),
          ),
    [
      comparisonResult,
      deferredState.analysisTab,
      deferredState.language,
      buildComparisonFocusedPanel,
    ],
  );
  const primaryObserverView = useMemo(
    () =>
      buildsObserverPanels && buildPrimaryFocusedPanel
        ? buildObserverViewPanelData(
            primaryResult,
            t(deferredState.language, "primaryModelTitle"),
            "primary",
          )
        : createEmptyObserverViewPanel(
            "primary",
            t(deferredState.language, "primaryModelTitle"),
          ),
    [primaryResult, buildsObserverPanels, deferredState.language, buildPrimaryFocusedPanel],
  );
  const comparisonObserverView = useMemo(
    () =>
      buildsObserverPanels && buildComparisonFocusedPanel
        ? buildObserverViewPanelData(
            comparisonResult,
            t(deferredState.language, "comparisonModelTitle"),
            "comparison",
          )
        : createEmptyObserverViewPanel(
            "comparison",
            t(deferredState.language, "comparisonModelTitle"),
          ),
    [
      comparisonResult,
      buildsObserverPanels,
      deferredState.language,
      buildComparisonFocusedPanel,
    ],
  );
  const routeMapPanel = useMemo(
    () =>
      deferredState.analysisTab === "route-map"
        ? buildRouteMapPanelData(
            primaryResult,
            t(deferredState.language, "routeMap"),
            "primary",
          )
        : createEmptyRouteMapPanel("primary", t(deferredState.language, "routeMap")),
    [primaryResult, deferredState.analysisTab, deferredState.language],
  );
  const primarySkyWrap = useMemo(
    () =>
      deferredState.analysisTab === "sky-wrap" && buildPrimaryFocusedPanel
        ? buildSkyWrapPanelData(
            primaryResult,
            t(deferredState.language, "primaryModelTitle"),
            "primary",
          )
        : createEmptySkyWrapPanel("primary", t(deferredState.language, "primaryModelTitle")),
    [primaryResult, deferredState.analysisTab, deferredState.language, buildPrimaryFocusedPanel],
  );
  const comparisonSkyWrap = useMemo(
    () =>
      deferredState.analysisTab === "sky-wrap" && buildComparisonFocusedPanel
        ? buildSkyWrapPanelData(
            comparisonResult,
            t(deferredState.language, "comparisonModelTitle"),
            "comparison",
          )
        : createEmptySkyWrapPanel(
            "comparison",
            t(deferredState.language, "comparisonModelTitle"),
          ),
    [
      comparisonResult,
      deferredState.analysisTab,
      deferredState.language,
      buildComparisonFocusedPanel,
    ],
  );
  const primaryInversionLab = useMemo(
    () =>
      deferredState.analysisTab === "inversion-lab" && buildPrimaryFocusedPanel
        ? buildInversionLabPanelData(
            primaryResult,
            t(deferredState.language, "primaryModelTitle"),
            "primary",
            deferredState.unitPreferences,
            deferredState.language,
          )
        : createEmptyInversionLabPanel(
            "primary",
            t(deferredState.language, "primaryModelTitle"),
          ),
    [
      primaryResult,
      deferredState.analysisTab,
      deferredState.language,
      deferredState.unitPreferences,
      buildPrimaryFocusedPanel,
    ],
  );
  const comparisonInversionLab = useMemo(
    () =>
      deferredState.analysisTab === "inversion-lab" && buildComparisonFocusedPanel
        ? buildInversionLabPanelData(
            comparisonResult,
            t(deferredState.language, "comparisonModelTitle"),
            "comparison",
            deferredState.unitPreferences,
            deferredState.language,
          )
        : createEmptyInversionLabPanel(
            "comparison",
            t(deferredState.language, "comparisonModelTitle"),
          ),
    [
      comparisonResult,
      deferredState.analysisTab,
      deferredState.language,
      deferredState.unitPreferences,
      buildComparisonFocusedPanel,
    ],
  );
  const sweepData = useMemo(
    () =>
      deferredState.analysisTab === "sweep"
        ? buildSweepChartData({
            scenario: deferredState.scenario,
            primaryModel: deferredState.primaryModel,
            comparisonModel: deferredState.comparisonModel,
            terrainProfile: terrainObstructionProfile,
            focusedModel: deferredState.focusedModel,
            compareMode: deferredState.viewMode === "compare",
            config: deferredState.sweepConfig,
            language: deferredState.language,
          })
        : createEmptySweepChartData(),
    [
      deferredState.analysisTab,
      deferredState.scenario,
      deferredState.primaryModel,
      deferredState.comparisonModel,
      terrainObstructionProfile,
      deferredState.focusedModel,
      deferredState.viewMode,
      deferredState.sweepConfig,
      deferredState.language,
    ],
  );

  const scenes =
    deferredState.viewMode === "compare"
      ? [primaryScene, comparisonScene]
      : [deferredState.focusedModel === "primary" ? primaryScene : comparisonScene];
  const bundlePanels =
    deferredState.viewMode === "compare"
      ? [primaryBundle, comparisonBundle]
      : [deferredState.focusedModel === "primary" ? primaryBundle : comparisonBundle];
  const profilePanels =
    deferredState.viewMode === "compare"
      ? [primaryProfileVisibility, comparisonProfileVisibility]
      : [
          deferredState.focusedModel === "primary"
            ? primaryProfileVisibility
            : comparisonProfileVisibility,
        ];
  const observerPanels =
    deferredState.viewMode === "compare"
      ? [primaryObserverView, comparisonObserverView]
      : [
          deferredState.focusedModel === "primary"
            ? primaryObserverView
            : comparisonObserverView,
        ];
  const skyWrapPanels =
    deferredState.viewMode === "compare"
      ? [primarySkyWrap, comparisonSkyWrap]
      : [
          deferredState.focusedModel === "primary"
            ? primarySkyWrap
            : comparisonSkyWrap,
        ];
  const inversionPanels =
    deferredState.viewMode === "compare"
      ? [primaryInversionLab, comparisonInversionLab]
      : [
          deferredState.focusedModel === "primary"
            ? primaryInversionLab
            : comparisonInversionLab,
        ];

  const visibleSceneKeys = new Set(scenes.map((scene) => scene.sceneKey));
  const hoveredFeatureVisible =
    state.hoveredFeatureId !== null &&
    (state.hoveredSceneKey === null || visibleSceneKeys.has(state.hoveredSceneKey));
  const hoveredSceneVisible =
    state.hoveredSceneKey !== null && visibleSceneKeys.has(state.hoveredSceneKey);
  const selectedFeatureVisible =
    state.selectedFeatureId !== null &&
    (state.selectedSceneKey === null || visibleSceneKeys.has(state.selectedSceneKey));
  const selectedSceneVisible =
    state.selectedSceneKey !== null && visibleSceneKeys.has(state.selectedSceneKey);
  const interactionEnabled = deferredState.analysisTab === "cross-section";
  const activeFeatureId = interactionEnabled
    ? hoveredFeatureVisible
      ? state.hoveredFeatureId
      : selectedFeatureVisible
        ? state.selectedFeatureId
        : null
    : null;
  const activeSceneKey = interactionEnabled
    ? hoveredFeatureVisible
      ? state.hoveredSceneKey
      : selectedFeatureVisible
        ? state.selectedSceneKey
        : null
    : null;
  const inspectedSceneKey =
    activeSceneKey ??
    (deferredState.viewMode === "compare" ? "primary" : deferredState.focusedModel);
  const inspectedResult =
    inspectedSceneKey === "primary" ? primaryResult : comparisonResult;
  const inspectedScene =
    inspectedSceneKey === "primary" ? primaryScene : comparisonScene;
  const inspectedBundlePanel =
    inspectedSceneKey === "primary" ? primaryBundle : comparisonBundle;
  const inspectedProfilePanel =
    inspectedSceneKey === "primary"
      ? primaryProfileVisibility
      : comparisonProfileVisibility;
  const inspectedObserverPanel =
    inspectedSceneKey === "primary" ? primaryObserverView : comparisonObserverView;
  const inspectedSkyWrapPanel =
    inspectedSceneKey === "primary" ? primarySkyWrap : comparisonSkyWrap;
  const inspectedInversionPanel =
    inspectedSceneKey === "primary" ? primaryInversionLab : comparisonInversionLab;
  const isFeaturePinned = interactionEnabled && selectedFeatureVisible;
  const displayedScenes = scenes;
  const legendAnnotations = useMemo(() => {
    const orderedScenes = [
      inspectedScene,
      ...displayedScenes.filter((scene) => scene.sceneKey !== inspectedScene.sceneKey),
    ];
    const merged = new Map<string, (typeof inspectedScene.annotations)[number]>();

    orderedScenes.forEach((scene) => {
      scene.annotations.forEach((annotation) => {
        if (!merged.has(annotation.id)) {
          merged.set(annotation.id, annotation);
        }
      });
    });

    return Array.from(merged.values());
  }, [displayedScenes, inspectedScene]);
  const suggestedVerticalScale =
    displayedScenes.reduce(
      (largest, scene) => Math.max(largest, scene.suggestedVerticalScale),
      1,
    );
  const useSceneFirstLayout =
    state.workspaceMode === "professional" || state.fullWidthScene;
  const resolvedCompareLayout =
    state.sceneViewport.compareLayout === "auto"
      ? windowWidth < 1180
        ? "stacked"
        : "side-by-side"
      : state.sceneViewport.compareLayout;
  const stackedCompareView =
    state.viewMode === "compare" && resolvedCompareLayout === "stacked";
  const adaptiveViewportMode =
    state.workspaceMode === "professional" &&
    (windowWidth < 1680 || windowHeight < 1100);
  const shouldShowLegendOverlay =
    deferredState.analysisTab === "cross-section" &&
    state.workspaceMode === "professional" &&
    useSceneFirstLayout &&
    showLegendOverlay;

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootHeight = document.documentElement.style.height;
    const previousBodyHeight = document.body.style.height;

    if (adaptiveViewportMode) {
      document.documentElement.style.height = "auto";
      document.body.style.height = "auto";
      document.body.style.overflow = "auto";
    } else {
      document.documentElement.style.height = "";
      document.body.style.height = "";
      document.body.style.overflow = "";
    }

    return () => {
      document.documentElement.style.height = previousRootHeight;
      document.body.style.height = previousBodyHeight;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [adaptiveViewportMode]);

  async function handleExport() {
    const svg = sceneHostRef.current?.querySelector("svg");

    if (!svg) {
      setMessage("The scene was not ready to export.");
      return;
    }

    try {
      await downloadSvgAsPng(
        svg as SVGSVGElement,
        getSceneFilename(state.analysisTab, state.viewMode),
      );
      setMessage("PNG exported from the current view.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "PNG export failed unexpectedly.",
      );
    }
  }

  async function handleCopyLink() {
    const url = `${window.location.origin}${window.location.pathname}${serializeStateToSearch(state)}`;

    try {
      await navigator.clipboard.writeText(url);
      setMessage("Share link copied to the clipboard.");
    } catch {
      setMessage(url);
    }
  }

  function handleExportJson() {
    try {
      const exportPayload = {
        exportedAt: new Date().toISOString(),
        analysisTab: state.analysisTab,
        viewMode: state.viewMode,
        state,
        routeMap: routeMapPanel,
        primaryResult: {
          model: getModelLabel(state.language, primaryResult.model),
          hiddenHeightM: primaryResult.hiddenHeightM,
          visibleHeightM: primaryResult.visibleHeightM,
          visibilityFraction: primaryResult.visibilityFraction,
          apparentElevationRad: primaryResult.apparentElevationRad,
          actualElevationRad: primaryResult.actualElevationRad,
          opticalHorizonDistanceM: primaryResult.opticalHorizon?.distanceM ?? null,
        },
        comparisonResult: {
          model: getModelLabel(state.language, comparisonResult.model),
          hiddenHeightM: comparisonResult.hiddenHeightM,
          visibleHeightM: comparisonResult.visibleHeightM,
          visibilityFraction: comparisonResult.visibilityFraction,
          apparentElevationRad: comparisonResult.apparentElevationRad,
          actualElevationRad: comparisonResult.actualElevationRad,
          opticalHorizonDistanceM: comparisonResult.opticalHorizon?.distanceM ?? null,
        },
      };

      downloadJson(`${getExportBasename(state.analysisTab, state.viewMode)}.json`, exportPayload);
      setMessage("JSON scenario snapshot exported.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "JSON export failed unexpectedly.");
    }
  }

  function handleExportReport() {
    try {
      downloadHtmlReport(`${getExportBasename(state.analysisTab, state.viewMode)}.html`, {
        title: "Geodesy Report",
        generatedAt: new Date().toLocaleString(),
        sections: [
          {
            title: "Scenario",
            rows: [
              { label: "Preset", value: deferredState.scenario.presetId },
              { label: "Analysis", value: getAnalysisTabLabel(state.language, state.analysisTab) },
              { label: "Scenario mode", value: deferredState.scenario.scenarioMode },
              { label: "Surface distance", value: `${deferredState.scenario.surfaceDistanceM.toFixed(0)} m` },
              { label: "Radius", value: `${deferredState.scenario.radiusM.toFixed(0)} m` },
            ],
          },
          {
            title: "Route",
            rows: [
              { label: "Coordinate route", value: routeMapPanel.coordinatesEnabled ? "Enabled" : "Disabled" },
              { label: "Derived distance", value: `${routeMapPanel.routeDistanceM.toFixed(0)} m` },
              { label: "Initial bearing", value: `${routeMapPanel.bearingDeg.toFixed(2)} deg` },
              { label: "Route samples", value: String(routeMapPanel.routePoints.length) },
            ],
          },
          {
            title: "Model 1",
            rows: [
              { label: "Label", value: getModelLabel(state.language, primaryResult.model) },
              { label: "Hidden height", value: `${primaryResult.hiddenHeightM.toFixed(2)} m` },
              { label: "Visibility fraction", value: primaryResult.visibilityFraction.toFixed(4) },
              { label: "Optical horizon", value: primaryResult.opticalHorizon ? `${primaryResult.opticalHorizon.distanceM.toFixed(2)} m` : "N/A" },
            ],
          },
          {
            title: "Model 2",
            rows: [
              { label: "Label", value: getModelLabel(state.language, comparisonResult.model) },
              { label: "Hidden height", value: `${comparisonResult.hiddenHeightM.toFixed(2)} m` },
              { label: "Visibility fraction", value: comparisonResult.visibilityFraction.toFixed(4) },
              { label: "Optical horizon", value: comparisonResult.opticalHorizon ? `${comparisonResult.opticalHorizon.distanceM.toFixed(2)} m` : "N/A" },
            ],
          },
        ],
      });
      setMessage("HTML observation report exported.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Report export failed unexpectedly.");
    }
  }

  async function handleToggleFullscreen() {
    const sceneElement = sceneHostRef.current;

    if (!sceneElement) {
      setMessage("The scene workspace was not ready for fullscreen mode.");
      return;
    }

    try {
      if (document.fullscreenElement === sceneElement) {
        await document.exitFullscreen();
      } else {
        await sceneElement.requestFullscreen();
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Fullscreen mode could not be started.",
      );
    }
  }

  function handleSceneHoverFeature(
    sceneKey: "primary" | "comparison" | null,
    featureId: string | null,
  ) {
    dispatch({ type: "setHoveredFeature", sceneKey, value: featureId });
  }

  function handleSceneSelectFeature(
    sceneKey: "primary" | "comparison" | null,
    featureId: string | null,
  ) {
    if (featureId == null || sceneKey == null) {
      dispatch({ type: "clearSelectedFeature" });
      return;
    }

    dispatch({ type: "setSelectedFeature", sceneKey, value: featureId });
  }

  function handleLegendToggleFeature(
    sceneKey: "primary" | "comparison" | null,
    featureId: string,
  ) {
    if (state.selectedSceneKey === sceneKey && state.selectedFeatureId === featureId) {
      dispatch({ type: "clearSelectedFeature" });
      return;
    }

    dispatch({ type: "setSelectedFeature", sceneKey, value: featureId });
  }

  return (
    <div
      className={`app-frame theme-${state.theme} workspace-${state.workspaceMode}${
        adaptiveViewportMode ? " app-frame--adaptive-viewport" : ""
      }`}
    >
      <div className="background-noise" />
      <TopNav
        theme={state.theme}
        language={state.language}
        workspaceMode={state.workspaceMode}
        onThemeChange={(value) => dispatch({ type: "setTheme", value })}
        onLanguageChange={(value) => dispatch({ type: "setLanguage", value })}
        onWorkspaceModeChange={(value) =>
          dispatch({ type: "setWorkspaceMode", value })
        }
      />

      <div
        className={
          useSceneFirstLayout
            ? `app-shell app-shell--fullwidth-scene${
                adaptiveViewportMode ? " app-shell--adaptive-viewport" : ""
              }`
            : "app-shell"
        }
      >
        <ControlsPanel
          state={state}
          dispatch={dispatch}
          onExport={handleExport}
          onExportJson={handleExportJson}
          onExportReport={handleExportReport}
          onCopyLink={handleCopyLink}
          language={state.language}
        />

        <main className="center-panel">
            <div
              className={
                deferredState.analysisTab === "ray-bundle"
                  ? `scene-card scene-card--ray-bundle panel${
                      state.fitContentHeight ? " scene-card--fit-content" : ""
                    }`
                  : deferredState.analysisTab === "profile-visibility"
                    ? `scene-card scene-card--profile-visibility panel${
                        state.fitContentHeight ? " scene-card--fit-content" : ""
                      }`
                  : deferredState.analysisTab === "route-map"
                    ? `scene-card scene-card--route-map panel${
                        state.fitContentHeight ? " scene-card--fit-content" : ""
                      }`
                  : deferredState.analysisTab === "sky-wrap"
                    ? `scene-card scene-card--sky-wrap panel${
                        state.fitContentHeight ? " scene-card--fit-content" : ""
                      }`
                  : deferredState.analysisTab === "refraction-lab"
                    ? `scene-card scene-card--refraction-lab panel${
                        state.fitContentHeight ? " scene-card--fit-content" : ""
                      }`
                  : deferredState.analysisTab === "inversion-lab"
                    ? `scene-card scene-card--inversion-lab panel${
                        state.fitContentHeight ? " scene-card--fit-content" : ""
                      }`
                  : deferredState.analysisTab === "sweep"
                    ? `scene-card scene-card--sweep panel${
                        state.fitContentHeight ? " scene-card--fit-content" : ""
                      }`
                    : `scene-card panel${state.fitContentHeight ? " scene-card--fit-content" : ""}`
              }
              ref={sceneHostRef}
            >
            <div className="scene-card__header">
              <div className="scene-card__intro">
                <p className="scene-card__eyebrow">{t(state.language, "simulationFirst")}</p>
                <h2>{t(state.language, "appEyebrow")}</h2>
                <p className="scene-card__text">
                  {t(state.language, "sharedSceneText")}
                </p>
              </div>

              <div className="scene-card__tools">
                <AnalysisTabs
                  value={state.analysisTab}
                  language={state.language}
                  onChange={(value) => dispatch({ type: "setAnalysisTab", value })}
                />

                <PresentationToolbar
                  state={state}
                  dispatch={dispatch}
                  language={state.language}
                />

                {state.analysisTab === "cross-section" ? (
                  <SceneToolbar
                    state={state}
                    dispatch={dispatch}
                    suggestedVerticalScale={suggestedVerticalScale}
                    isFullscreen={isSceneFullscreen}
                    showLegend={shouldShowLegendOverlay}
                    onToggleLegend={() => setShowLegendOverlay((current) => !current)}
                    onToggleFullscreen={handleToggleFullscreen}
                    language={state.language}
                  />
                ) : (
                  <div className="scene-toolbar scene-toolbar--compact">
                    <div className="scene-toolbar__group scene-toolbar__group--meta">
                      <span className="scene-toolbar__meta scene-toolbar__meta--hint">
                        {state.analysisTab === "ray-bundle"
                          ? t(state.language, "rayBundleIntro")
                          : state.analysisTab === "observer-view"
                            ? t(state.language, "observerViewIntro")
                          : state.analysisTab === "profile-visibility"
                            ? t(state.language, "profileVisibilityIntro")
                          : state.analysisTab === "route-map"
                            ? t(state.language, "routeMapIntro")
                          : state.analysisTab === "sky-wrap"
                            ? t(state.language, "skyWrapIntro")
                          : state.analysisTab === "refraction-lab"
                            ? t(state.language, "refractionLabIntro")
                          : state.analysisTab === "inversion-lab"
                            ? t(state.language, "inversionLabIntro")
                          : `${t(state.language, "sweepIntro")} ${formatSweepParameterValue(
                              sweepData.range.min,
                              sweepData.parameter,
                              state.unitPreferences,
                            )} to ${formatSweepParameterValue(
                              sweepData.range.max,
                              sweepData.parameter,
                              state.unitPreferences,
                            )} • ${state.sweepConfig.sampleCount} solves`}
                      </span>
                    </div>
                    <div className="scene-toolbar__group">
                      <span className="scene-toolbar__label">{t(state.language, "heightMode")}</span>
                      <button
                        type="button"
                        className={
                          state.fitContentHeight
                            ? "scene-toolbar__button scene-toolbar__button--active"
                            : "scene-toolbar__button"
                        }
                        onClick={() =>
                          dispatch({
                            type: "setFitContentHeight",
                            value: !state.fitContentHeight,
                          })
                        }
                      >
                        {t(state.language, "fitContent")}
                      </button>
                    </div>
                    <div className="scene-toolbar__group">
                      <span className="scene-toolbar__label">{t(state.language, "zoom")}</span>
                      <button
                        type="button"
                        className="scene-toolbar__button"
                        onClick={() => dispatch({ type: "adjustViewportZoom", delta: -0.15 })}
                      >
                        -
                      </button>
                      <span className="scene-toolbar__value">
                        {state.sceneViewport.zoom.toFixed(2)}x
                      </span>
                      <button
                        type="button"
                        className="scene-toolbar__button"
                        onClick={() => dispatch({ type: "adjustViewportZoom", delta: 0.15 })}
                      >
                        +
                      </button>
                    </div>
                    <div className="scene-toolbar__group">
                      <span className="scene-toolbar__label">{t(state.language, "vertical")}</span>
                      <button
                        type="button"
                        className="scene-toolbar__button"
                        onClick={() =>
                          dispatch({ type: "adjustViewportVerticalZoom", delta: -0.2 })
                        }
                      >
                        -
                      </button>
                      <span className="scene-toolbar__value">
                        {state.sceneViewport.verticalZoom.toFixed(2)}x
                      </span>
                      <button
                        type="button"
                        className="scene-toolbar__button"
                        onClick={() =>
                          dispatch({ type: "adjustViewportVerticalZoom", delta: 0.2 })
                        }
                      >
                        +
                      </button>
                    </div>
                    <div className="scene-toolbar__group scene-toolbar__group--meta">
                      <span className="scene-toolbar__meta">
                        {t(state.language, "analysisViewportHint")}
                      </span>
                      <button
                        type="button"
                        className="scene-toolbar__button"
                        onClick={() => dispatch({ type: "resetViewport" })}
                      >
                        {t(state.language, "reset")}
                      </button>
                    </div>
                    <div className="scene-toolbar__group">
                      <button
                        type="button"
                        className="scene-toolbar__button"
                        onClick={handleToggleFullscreen}
                      >
                        {isSceneFullscreen
                          ? t(state.language, "exitFullscreen")
                          : t(state.language, "fullscreen")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {state.analysisTab === "cross-section" ? (
              <div
                className={
                  shouldShowLegendOverlay
                    ? stackedCompareView
                      ? "scene-card__viewport scene-card__viewport--with-legend scene-card__viewport--stacked-list"
                      : "scene-card__viewport scene-card__viewport--with-legend"
                    : stackedCompareView
                      ? "scene-card__viewport scene-card__viewport--stacked-list"
                      : "scene-card__viewport"
                }
              >
                <div
                  className={
                    stackedCompareView
                      ? "scene-stack-list"
                      : "scene-card__canvas"
                  }
                >
                  {stackedCompareView ? (
                    scenes.map((scene) => (
                      <div key={scene.sceneKey} className="scene-stack-item">
                        <SceneSvg
                          scenes={[scene]}
                          annotated={state.annotated}
                          labelDensity={state.labelDensity}
                          showScaleGuides={state.showScaleGuides}
                          showTerrainOverlay={state.showTerrainOverlay}
                          activeFeatureId={activeFeatureId}
                          activeSceneKey={activeSceneKey}
                          hoveredFeatureId={state.hoveredFeatureId}
                          hoveredSceneKey={state.hoveredSceneKey}
                          selectedFeatureId={state.selectedFeatureId}
                          selectedSceneKey={state.selectedSceneKey}
                          framingMode={state.sceneViewport.framingMode}
                          scaleMode={state.sceneViewport.scaleMode}
                          compareLayout="side-by-side"
                          fitContentHeight={state.fitContentHeight}
                          zoom={state.sceneViewport.zoom}
                          verticalZoom={state.sceneViewport.verticalZoom}
                          panX={state.sceneViewport.panX}
                          panY={state.sceneViewport.panY}
                          unitPreferences={state.unitPreferences}
                          language={state.language}
                          onHoverFeature={handleSceneHoverFeature}
                          onSelectFeature={handleSceneSelectFeature}
                          onPanBy={(deltaX, deltaY) =>
                            dispatch({ type: "panViewport", deltaX, deltaY })
                          }
                          onAdjustZoom={(delta) =>
                            dispatch({ type: "adjustViewportZoom", delta })
                          }
                          onAdjustVerticalZoom={(delta) =>
                            dispatch({ type: "adjustViewportVerticalZoom", delta })
                          }
                        />
                      </div>
                    ))
                  ) : (
                    <SceneSvg
                      scenes={scenes}
                      annotated={state.annotated}
                      labelDensity={state.labelDensity}
                      showScaleGuides={state.showScaleGuides}
                      showTerrainOverlay={state.showTerrainOverlay}
                      activeFeatureId={activeFeatureId}
                      activeSceneKey={activeSceneKey}
                      hoveredFeatureId={state.hoveredFeatureId}
                      hoveredSceneKey={state.hoveredSceneKey}
                      selectedFeatureId={state.selectedFeatureId}
                      selectedSceneKey={state.selectedSceneKey}
                      framingMode={state.sceneViewport.framingMode}
                      scaleMode={state.sceneViewport.scaleMode}
                      compareLayout={resolvedCompareLayout}
                      fitContentHeight={state.fitContentHeight}
                      zoom={state.sceneViewport.zoom}
                      verticalZoom={state.sceneViewport.verticalZoom}
                      panX={state.sceneViewport.panX}
                      panY={state.sceneViewport.panY}
                      unitPreferences={state.unitPreferences}
                      language={state.language}
                      onHoverFeature={handleSceneHoverFeature}
                      onSelectFeature={handleSceneSelectFeature}
                      onPanBy={(deltaX, deltaY) =>
                        dispatch({ type: "panViewport", deltaX, deltaY })
                      }
                      onAdjustZoom={(delta) =>
                        dispatch({ type: "adjustViewportZoom", delta })
                      }
                      onAdjustVerticalZoom={(delta) =>
                        dispatch({ type: "adjustViewportVerticalZoom", delta })
                      }
                    />
                  )}
                </div>
                <SceneLegendOverlay
                  annotations={legendAnnotations}
                  sceneKey={state.viewMode === "compare" ? null : inspectedScene.sceneKey}
                  activeFeatureId={activeFeatureId}
                  selectedFeatureId={state.selectedFeatureId}
                  selectedSceneKey={state.selectedSceneKey}
                  visible={shouldShowLegendOverlay}
                  showTerrainOverlay={state.showTerrainOverlay}
                  language={state.language}
                  onHoverFeature={handleSceneHoverFeature}
                  onToggleFeature={handleLegendToggleFeature}
                />
              </div>
            ) : (
              <AnalysisErrorBoundary
                activeKey={`${state.analysisTab}:${state.viewMode}:${resolvedCompareLayout}:${state.selectedSceneKey}`}
              >
                <Suspense
                  fallback={
                    <AnalysisLoadingFallback
                      message={t(state.language, "loadingAnalysisWorkspace")}
                    />
                  }
                >
                  {state.analysisTab === "ray-bundle" ? (
                  <div
                    className={
                      stackedCompareView
                        ? "scene-card__viewport scene-card__viewport--analysis scene-card__viewport--stacked-list"
                        : "scene-card__viewport scene-card__viewport--analysis"
                    }
                  >
                    <div
                      className={
                        stackedCompareView
                          ? "scene-stack-list"
                          : "scene-card__canvas"
                      }
                    >
                      {stackedCompareView ? (
                        bundlePanels.map((panel) => (
                          <div
                            key={panel.sceneKey}
                            className="scene-stack-item scene-stack-item--analysis"
                          >
                            <RayBundleView
                              panels={[panel]}
                              compareLayout="side-by-side"
                              unitPreferences={state.unitPreferences}
                              language={state.language}
                              showScaleGuides={state.showScaleGuides}
                              fitContentHeight={state.fitContentHeight}
                              zoom={state.sceneViewport.zoom}
                              verticalZoom={state.sceneViewport.verticalZoom}
                              panX={state.sceneViewport.panX}
                              panY={state.sceneViewport.panY}
                              onPanBy={(deltaX, deltaY) =>
                                dispatch({ type: "panViewport", deltaX, deltaY })
                              }
                              onAdjustZoom={(delta) =>
                                dispatch({ type: "adjustViewportZoom", delta })
                              }
                              onAdjustVerticalZoom={(delta) =>
                                dispatch({ type: "adjustViewportVerticalZoom", delta })
                              }
                            />
                          </div>
                        ))
                      ) : (
                        <RayBundleView
                          panels={bundlePanels}
                          compareLayout={resolvedCompareLayout}
                          unitPreferences={state.unitPreferences}
                          language={state.language}
                          showScaleGuides={state.showScaleGuides}
                          fitContentHeight={state.fitContentHeight}
                          zoom={state.sceneViewport.zoom}
                          verticalZoom={state.sceneViewport.verticalZoom}
                          panX={state.sceneViewport.panX}
                          panY={state.sceneViewport.panY}
                          onPanBy={(deltaX, deltaY) =>
                            dispatch({ type: "panViewport", deltaX, deltaY })
                          }
                          onAdjustZoom={(delta) =>
                            dispatch({ type: "adjustViewportZoom", delta })
                          }
                          onAdjustVerticalZoom={(delta) =>
                            dispatch({ type: "adjustViewportVerticalZoom", delta })
                          }
                        />
                      )}
                    </div>
                  </div>
                ) : state.analysisTab === "observer-view" ? (
                  <div
                    className={
                      stackedCompareView
                        ? "scene-card__viewport scene-card__viewport--analysis scene-card__viewport--stacked-list"
                        : "scene-card__viewport scene-card__viewport--analysis"
                    }
                  >
                    <div
                      className={
                        stackedCompareView
                          ? "scene-stack-list"
                          : "scene-card__canvas"
                      }
                    >
                      {stackedCompareView ? (
                        observerPanels.map((panel) => (
                          <div
                            key={panel.sceneKey}
                            className="scene-stack-item scene-stack-item--analysis"
                          >
                            <ObserverView
                              panels={[panel]}
                              compareLayout="side-by-side"
                              unitPreferences={state.unitPreferences}
                              language={state.language}
                              showScaleGuides={state.showScaleGuides}
                              annotated={state.annotated}
                              fitContentHeight={state.fitContentHeight}
                              zoom={state.sceneViewport.zoom}
                              verticalZoom={state.sceneViewport.verticalZoom}
                              panX={state.sceneViewport.panX}
                              panY={state.sceneViewport.panY}
                              onPanBy={(deltaX, deltaY) =>
                                dispatch({ type: "panViewport", deltaX, deltaY })
                              }
                              onAdjustZoom={(delta) =>
                                dispatch({ type: "adjustViewportZoom", delta })
                              }
                              onAdjustVerticalZoom={(delta) =>
                                dispatch({ type: "adjustViewportVerticalZoom", delta })
                              }
                            />
                          </div>
                        ))
                      ) : (
                        <ObserverView
                          panels={observerPanels}
                          compareLayout={resolvedCompareLayout}
                          unitPreferences={state.unitPreferences}
                          language={state.language}
                          showScaleGuides={state.showScaleGuides}
                          annotated={state.annotated}
                          fitContentHeight={state.fitContentHeight}
                          zoom={state.sceneViewport.zoom}
                          verticalZoom={state.sceneViewport.verticalZoom}
                          panX={state.sceneViewport.panX}
                          panY={state.sceneViewport.panY}
                          onPanBy={(deltaX, deltaY) =>
                            dispatch({ type: "panViewport", deltaX, deltaY })
                          }
                          onAdjustZoom={(delta) =>
                            dispatch({ type: "adjustViewportZoom", delta })
                          }
                          onAdjustVerticalZoom={(delta) =>
                            dispatch({ type: "adjustViewportVerticalZoom", delta })
                          }
                        />
                      )}
                    </div>
                  </div>
                ) : state.analysisTab === "refraction-lab" ? (
                  <div
                    className={
                      stackedCompareView
                        ? "scene-card__viewport scene-card__viewport--analysis scene-card__viewport--stacked-list"
                        : "scene-card__viewport scene-card__viewport--analysis"
                    }
                  >
                    <div
                      className={
                        stackedCompareView
                          ? "scene-stack-list"
                          : "scene-card__canvas"
                      }
                    >
                      {stackedCompareView ? (
                        observerPanels.map((observerPanel, panelIndex) => {
                          const bundlePanel = bundlePanels[panelIndex];
                          const result =
                            panelIndex === 0 ? primaryResult : comparisonResult;

                          if (!bundlePanel) {
                            return null;
                          }

                          return (
                            <div
                              key={observerPanel.sceneKey}
                              className="scene-stack-item scene-stack-item--analysis"
                            >
                              <RefractionLabView
                                observerPanels={[observerPanel]}
                                bundlePanels={[bundlePanel]}
                                results={[result]}
                                compareLayout="side-by-side"
                                unitPreferences={state.unitPreferences}
                                language={state.language}
                                showScaleGuides={state.showScaleGuides}
                                annotated={state.annotated}
                                fitContentHeight={state.fitContentHeight}
                                zoom={state.sceneViewport.zoom}
                                verticalZoom={state.sceneViewport.verticalZoom}
                                panX={state.sceneViewport.panX}
                                panY={state.sceneViewport.panY}
                                onPanBy={(deltaX, deltaY) =>
                                  dispatch({ type: "panViewport", deltaX, deltaY })
                                }
                                onAdjustZoom={(delta) =>
                                  dispatch({ type: "adjustViewportZoom", delta })
                                }
                                onAdjustVerticalZoom={(delta) =>
                                  dispatch({ type: "adjustViewportVerticalZoom", delta })
                                }
                              />
                            </div>
                          );
                        })
                      ) : (
                        <RefractionLabView
                          observerPanels={observerPanels}
                          bundlePanels={bundlePanels}
                          results={
                            deferredState.viewMode === "compare"
                              ? [primaryResult, comparisonResult]
                              : [
                                  deferredState.focusedModel === "primary"
                                    ? primaryResult
                                    : comparisonResult,
                                ]
                          }
                          compareLayout={resolvedCompareLayout}
                          unitPreferences={state.unitPreferences}
                          language={state.language}
                          showScaleGuides={state.showScaleGuides}
                          annotated={state.annotated}
                          fitContentHeight={state.fitContentHeight}
                          zoom={state.sceneViewport.zoom}
                          verticalZoom={state.sceneViewport.verticalZoom}
                          panX={state.sceneViewport.panX}
                          panY={state.sceneViewport.panY}
                          onPanBy={(deltaX, deltaY) =>
                            dispatch({ type: "panViewport", deltaX, deltaY })
                          }
                          onAdjustZoom={(delta) =>
                            dispatch({ type: "adjustViewportZoom", delta })
                          }
                          onAdjustVerticalZoom={(delta) =>
                            dispatch({ type: "adjustViewportVerticalZoom", delta })
                          }
                        />
                      )}
                    </div>
                  </div>
                ) : state.analysisTab === "profile-visibility" ? (
                  <div
                    className={
                      stackedCompareView
                        ? "scene-card__viewport scene-card__viewport--analysis scene-card__viewport--stacked-list"
                        : "scene-card__viewport scene-card__viewport--analysis"
                    }
                  >
                    <div
                      className={
                        stackedCompareView
                          ? "scene-stack-list"
                          : "scene-card__canvas"
                      }
                    >
                      {stackedCompareView ? (
                        profilePanels.map((panel) => (
                          <div
                            key={panel.sceneKey}
                            className="scene-stack-item scene-stack-item--analysis"
                          >
                            <ProfileVisibilityView
                              panels={[panel]}
                              compareLayout="side-by-side"
                              unitPreferences={state.unitPreferences}
                              language={state.language}
                              showScaleGuides={state.showScaleGuides}
                              fitContentHeight={state.fitContentHeight}
                              zoom={state.sceneViewport.zoom}
                              verticalZoom={state.sceneViewport.verticalZoom}
                              panX={state.sceneViewport.panX}
                              panY={state.sceneViewport.panY}
                              onPanBy={(deltaX, deltaY) =>
                                dispatch({ type: "panViewport", deltaX, deltaY })
                              }
                              onAdjustZoom={(delta) =>
                                dispatch({ type: "adjustViewportZoom", delta })
                              }
                              onAdjustVerticalZoom={(delta) =>
                                dispatch({ type: "adjustViewportVerticalZoom", delta })
                              }
                            />
                          </div>
                        ))
                      ) : (
                        <ProfileVisibilityView
                          panels={profilePanels}
                          compareLayout={resolvedCompareLayout}
                          unitPreferences={state.unitPreferences}
                          language={state.language}
                          showScaleGuides={state.showScaleGuides}
                          fitContentHeight={state.fitContentHeight}
                          zoom={state.sceneViewport.zoom}
                          verticalZoom={state.sceneViewport.verticalZoom}
                          panX={state.sceneViewport.panX}
                          panY={state.sceneViewport.panY}
                          onPanBy={(deltaX, deltaY) =>
                            dispatch({ type: "panViewport", deltaX, deltaY })
                          }
                          onAdjustZoom={(delta) =>
                            dispatch({ type: "adjustViewportZoom", delta })
                          }
                          onAdjustVerticalZoom={(delta) =>
                            dispatch({ type: "adjustViewportVerticalZoom", delta })
                          }
                        />
                      )}
                    </div>
                  </div>
                ) : state.analysisTab === "route-map" ? (
                  <div className="scene-card__viewport scene-card__viewport--analysis">
                    <div className="scene-card__canvas">
                      <RouteMapView
                        panel={routeMapPanel}
                        language={state.language}
                        onCoordinateModeChange={(enabled) => {
                          startTransition(() => {
                            if (enabled && routeMapPanel.usesPreviewSeed) {
                              dispatch({
                                type: "setCoordinateField",
                                key: "observerLatDeg",
                                value: routeMapPanel.observerPoint.latDeg,
                              });
                              dispatch({
                                type: "setCoordinateField",
                                key: "observerLonDeg",
                                value: routeMapPanel.observerPoint.lonDeg,
                              });
                              dispatch({
                                type: "setCoordinateField",
                                key: "targetLatDeg",
                                value: routeMapPanel.targetPoint.latDeg,
                              });
                              dispatch({
                                type: "setCoordinateField",
                                key: "targetLonDeg",
                                value: routeMapPanel.targetPoint.lonDeg,
                              });
                            }
                            dispatch({
                              type: "setCoordinateField",
                              key: "enabled",
                              value: enabled,
                            });
                          });
                        }}
                        onCoordinateChange={(point, coords) => {
                          startTransition(() => {
                            dispatch({
                              type: "setCoordinateField",
                              key:
                                point === "observer" ? "observerLatDeg" : "targetLatDeg",
                              value: coords.latDeg,
                            });
                            dispatch({
                              type: "setCoordinateField",
                              key:
                                point === "observer" ? "observerLonDeg" : "targetLonDeg",
                              value: coords.lonDeg,
                            });
                          });
                        }}
                      />
                    </div>
                  </div>
                ) : state.analysisTab === "sky-wrap" ? (
                  <div
                    className={
                      stackedCompareView
                        ? "scene-card__viewport scene-card__viewport--analysis scene-card__viewport--stacked-list"
                        : "scene-card__viewport scene-card__viewport--analysis"
                    }
                  >
                    <div
                      className={
                        stackedCompareView
                          ? "scene-stack-list"
                          : "scene-card__canvas"
                      }
                    >
                      {stackedCompareView ? (
                        skyWrapPanels.map((panel) => (
                          <div
                            key={panel.sceneKey}
                            className="scene-stack-item scene-stack-item--analysis"
                          >
                            <SkyWrapView
                              panels={[panel]}
                              compareLayout="side-by-side"
                              language={state.language}
                              fitContentHeight={state.fitContentHeight}
                              zoom={state.sceneViewport.zoom}
                              verticalZoom={state.sceneViewport.verticalZoom}
                              panX={state.sceneViewport.panX}
                              panY={state.sceneViewport.panY}
                              onPanBy={(deltaX, deltaY) =>
                                dispatch({ type: "panViewport", deltaX, deltaY })
                              }
                              onAdjustZoom={(delta) =>
                                dispatch({ type: "adjustViewportZoom", delta })
                              }
                              onAdjustVerticalZoom={(delta) =>
                                dispatch({ type: "adjustViewportVerticalZoom", delta })
                              }
                            />
                          </div>
                        ))
                      ) : (
                        <SkyWrapView
                          panels={skyWrapPanels}
                          compareLayout={resolvedCompareLayout}
                          language={state.language}
                          fitContentHeight={state.fitContentHeight}
                          zoom={state.sceneViewport.zoom}
                          verticalZoom={state.sceneViewport.verticalZoom}
                          panX={state.sceneViewport.panX}
                          panY={state.sceneViewport.panY}
                          onPanBy={(deltaX, deltaY) =>
                            dispatch({ type: "panViewport", deltaX, deltaY })
                          }
                          onAdjustZoom={(delta) =>
                            dispatch({ type: "adjustViewportZoom", delta })
                          }
                          onAdjustVerticalZoom={(delta) =>
                            dispatch({ type: "adjustViewportVerticalZoom", delta })
                          }
                        />
                      )}
                    </div>
                  </div>
                ) : state.analysisTab === "inversion-lab" ? (
                  <div
                    className={
                      stackedCompareView
                        ? "scene-card__viewport scene-card__viewport--analysis scene-card__viewport--stacked-list"
                        : "scene-card__viewport scene-card__viewport--analysis"
                    }
                  >
                    <div
                      className={
                        stackedCompareView
                          ? "scene-stack-list"
                          : "scene-card__canvas"
                      }
                    >
                      {stackedCompareView ? (
                        inversionPanels.map((panel) => (
                          <div
                            key={panel.sceneKey}
                            className="scene-stack-item scene-stack-item--analysis"
                          >
                            <InversionLabView
                              panels={[panel]}
                              compareLayout="side-by-side"
                              language={state.language}
                              annotated={state.annotated}
                              showGuides={state.showScaleGuides}
                              fitContentHeight={state.fitContentHeight}
                              zoom={state.sceneViewport.zoom}
                              verticalZoom={state.sceneViewport.verticalZoom}
                              panX={state.sceneViewport.panX}
                              panY={state.sceneViewport.panY}
                              onPanBy={(deltaX, deltaY) =>
                                dispatch({ type: "panViewport", deltaX, deltaY })
                              }
                              onAdjustZoom={(delta) =>
                                dispatch({ type: "adjustViewportZoom", delta })
                              }
                              onAdjustVerticalZoom={(delta) =>
                                dispatch({ type: "adjustViewportVerticalZoom", delta })
                              }
                            />
                          </div>
                        ))
                      ) : (
                        <InversionLabView
                          panels={inversionPanels}
                          compareLayout={resolvedCompareLayout}
                          language={state.language}
                          annotated={state.annotated}
                          showGuides={state.showScaleGuides}
                          fitContentHeight={state.fitContentHeight}
                          zoom={state.sceneViewport.zoom}
                          verticalZoom={state.sceneViewport.verticalZoom}
                          panX={state.sceneViewport.panX}
                          panY={state.sceneViewport.panY}
                          onPanBy={(deltaX, deltaY) =>
                            dispatch({ type: "panViewport", deltaX, deltaY })
                          }
                          onAdjustZoom={(delta) =>
                            dispatch({ type: "adjustViewportZoom", delta })
                          }
                          onAdjustVerticalZoom={(delta) =>
                            dispatch({ type: "adjustViewportVerticalZoom", delta })
                          }
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="scene-card__viewport scene-card__viewport--analysis">
                    <div className="scene-card__canvas">
                      <SweepChart
                        data={sweepData}
                        units={state.unitPreferences}
                        language={state.language}
                        fitContentHeight={state.fitContentHeight}
                        zoom={state.sceneViewport.zoom}
                        verticalZoom={state.sceneViewport.verticalZoom}
                        panX={state.sceneViewport.panX}
                        panY={state.sceneViewport.panY}
                        onPanBy={(deltaX, deltaY) =>
                          dispatch({ type: "panViewport", deltaX, deltaY })
                        }
                        onAdjustZoom={(delta) =>
                          dispatch({ type: "adjustViewportZoom", delta })
                        }
                        onAdjustVerticalZoom={(delta) =>
                          dispatch({ type: "adjustViewportVerticalZoom", delta })
                        }
                      />
                    </div>
                  </div>
                  )}
                </Suspense>
              </AnalysisErrorBoundary>
            )}
          </div>
        </main>

        <RightPanel
          state={state}
          activeResult={inspectedResult}
          activeScene={inspectedScene}
          activeBundlePanel={inspectedBundlePanel}
          activeProfilePanel={inspectedProfilePanel}
          activeObserverPanel={inspectedObserverPanel}
          activeRouteMapPanel={routeMapPanel}
          activeSkyWrapPanel={inspectedSkyWrapPanel}
          activeInversionPanel={inspectedInversionPanel}
          sweepData={sweepData}
          inspectedSceneKey={inspectedSceneKey}
          activeFeatureId={activeFeatureId}
          isFeaturePinned={Boolean(isFeaturePinned)}
          onClearSelection={() => dispatch({ type: "clearSelectedFeature" })}
          workspaceMode={state.workspaceMode}
          onExport={handleExport}
          onExportJson={handleExportJson}
          onExportReport={handleExportReport}
          onCopyLink={handleCopyLink}
          message={message}
          language={state.language}
          sceneFirstLayout={useSceneFirstLayout}
        />
      </div>

      <AppFooter language={state.language} />
      <Analytics />
    </div>
  );
}
