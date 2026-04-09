/* global document, fetch, window */
import React, { Component } from "react";
import { render } from "react-dom";
import MapGL from "react-map-gl";
import ReactMapGL, { LinearInterpolator, FlyToInterpolator } from "react-map-gl";
import { easeLinear } from "d3-ease";

/* Core Components */
import { LayerControls } from "./LayerControl";
import DeckGLOverlay from "./DeckglOverlay";

/* Style */
import './styles/style.scss';

// Data import
import taxiData from "./data/taxi";
import { BUILDINGS } from "./data/buildings";
import { TRIPS } from "./data/trips";
import { HEXAGON_CONTROLS, hexagonView } from './config/layer-configs';

// Set your mapbox token here
const MAPBOX_TOKEN = ""; // WARNING: Token revoked. Use .env.local for secrets.
const MAPBOX_STYLE1 = "mapbox://styles/mapbox/dark-v9";
const MAPBOX_STYLE2 = "data/map-style-dark-v9-no-labels.json";

class Root extends Component {

  constructor(props) {
    super(props);

    const defaultViewport = DeckGLOverlay.defaultViewport;
    let viewport = {};

    if (HEXAGON_CONTROLS.showHexagon.value) {
      Object.assign(viewport, defaultViewport, hexagonView);
    } else {
      Object.assign(viewport, defaultViewport)
    }

    this.state = {
      viewport: {
        ...viewport,
        width: 500,
        height: 500
      },
      buildings: null,
      trips: null,
      time: 0,
      points: [],
      settings: Object.keys(HEXAGON_CONTROLS).reduce(
        (accu, key) => ({
          ...accu,
          [key]: HEXAGON_CONTROLS[key].value,
        }),
        {}
      ),
      // hoverInfo
      x: 0,
      y: 0,
      hoveredObject: null,
      status: "LOADING"
    };

  }

  componentDidMount() {
    
    window.addEventListener("resize", this._resize.bind(this));
    this._resize();
    this._animate();

    fetch(BUILDINGS)
      .then(resp => resp.json())
      .then(data => this.setState({ buildings: data }));

    fetch("./data/trips.json")
      .then(resp => resp.json())
      .then(data => this.setState({ trips: data }));

    this._processData();
  }

  componentWillUnmount() {
    if (this._animationFrame) {
      window.cancelAnimationFrame(this._animationFrame);
    }
  }

  _resize() {
    this._onViewportChange({
      width: window.innerWidth,
      height: window.innerHeight
    });
  }

  _updateLayerSettings(settings) {

    console.log(settings);
  

    if (!settings.showHexagon) {

      this._flyToSPOT({
        "bearing": 0,
        "center": [40.72, -74],
        "zoom": 13.2,
        "pitch": 60,
        "transitionDuration": 1000
      })
    } else {

      this._flyToSPOT({
        "zoom": 11,
        "bearing": 0,
        "pitch": 60,
        "center": [40.72, -74.0],
        "transitionDuration": 1000
      })
    }

    this.setState({ settings });

  }

  _onViewportChange(viewport) {
    this.setState({
      viewport: { ...this.state.viewport, ...viewport }
    });
  }

  _processData() {
    if (taxiData) {
      this.setState({status: 'LOADED'});
      const points = taxiData.reduce((accu, curr) => {
        accu.push({
          position: [Number(curr.pickup_longitude), Number(curr.pickup_latitude)],
          sourcePosition: [Number(curr.pickup_longitude), Number(curr.pickup_latitude)],
          pickup: true,
        });

        accu.push({
          position: [Number(curr.dropoff_longitude), Number(curr.dropoff_latitude)],
          targetPosition: [Number(curr.dropoff_longitude), Number(curr.dropoff_latitude)],
          pickup: false,
        });
        return accu;
      }, []);
      this.setState({
        points,
        status: 'READY'
      });
    }
  }

  _animate() {
    const timestamp = Date.now();
    const loopLength = 1800;
    const loopTime = 90000;

    this.setState({
      time: (timestamp % loopTime) / loopTime * loopLength
    });
    this._animationFrame = window.requestAnimationFrame(
      this._animate.bind(this)
    );
  }

  _switchLabels(){
    
  }

  _flyToSPOT(location) {
    const viewport = {
      ...this.state.viewport,
      transitionDuration: 3000,
      ...location,
      transitionInterpolator: new FlyToInterpolator(),
      transitionEasing: easeLinear
    };
    
    Object.assign(viewport, {
      latitude: location.center[0],
      longitude: location.center[1]
    });

    this.setState({ viewport });
  }

  render() {
    const { viewport, buildings, trips, time, points } = this.state;

    return (
      <div>
        <header>
          <div className="banner">
            <h2>Urban Mobility Development Project</h2>

          </div>
          </header>
        <LayerControls
          MapGL={this.MapGL}
          settings={this.state.settings}
          propTypes={HEXAGON_CONTROLS}
          onChange={settings => this._updateLayerSettings(settings)}
          flyToSPOT={this._flyToSPOT.bind(this)}
        />
        <ReactMapGL
          {...viewport}
          /*
          dark-v9
          navigation-preview-night-v2
          navigation-guidance-night-v2
          */
          mapStyle={MAPBOX_STYLE2}
          mapboxApiAccessToken={MAPBOX_TOKEN}
          onViewportChange={this._onViewportChange.bind(this)}
          ref={div => {
            this.MapGL = div;
            return div;
          }}
        >
          <DeckGLOverlay
            viewport={viewport}
            buildings={buildings}
            data={points}
            trips={trips}
            trailLength={180}
            time={time}
            {...this.state.settings}
          />
        </ReactMapGL>
      </div>
    );
  }
}
/*
map.style.stylesheet.layers.forEach(function(layer) {
  if (layer.type === 'symbol') {
      map.removeLayer(layer.id);
  }
});
*/

render(<Root />, document.body.appendChild(document.createElement("div")));
