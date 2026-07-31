import React, { Component } from "react";
import { layerControl } from "./styles/style";

import * as CongestionSpotData from "./data/congestion.json";

export class LayerControls extends Component {
  constructor(props) {
    super(props);
    this.state = {};
  }

  _onValueChange(settingName, newValue) {

    const {settings} = this.props;
    // Only update if we have a confirmed change
    if (settings[settingName] !== newValue) {
      // Create a new object so that shallow-equal detects a change
      const newSettings = {
        ...this.props.settings,
        [settingName]: newValue
      };

      this.props.onChange(newSettings);
    }
  }

  _flyToSPOT(e) {
    const { flyToSPOT } = this.props;

    const spot = e.target.innerHTML;
    console.log(spot);
    if (flyToSPOT) flyToSPOT(CongestionSpotData[spot]);
  }

  render() {
    const { title, settings, propTypes = {} } = this.props;

    return (
      <div className="layer-controls" style={layerControl}>
        <h4>{"New York CityWide Congested Corridors"}</h4>
        <p>A Capstone Project proposal for The Data Incubator Fellowship Program by Parvez Kose</p>


        <div className="congestion_points">

        <p><h4>Traffic Corridors: </h4>The street intersections with highest traffic congestion in New York city. </p>
        <br />
        <p>Click the link below to interpolate between locations.</p>

          <ul
          ref={div => {
            this.SPOTS= div;
            return div;
          }}>
            {Object.keys(CongestionSpotData).map((item, key) => (
              <li>
                <a
                href="#"
                onClick={this._flyToSPOT.bind(this)}
                >
                  {item}
                </a>
              </li>
            ))}

          </ul>
          <div><button onClick={this._flyToSPOT.bind(this)}>Reset View</button></div>
        </div>


        {Object.keys(settings).map(key =>
          <div className="ctrls" key={key}>

            <Setting
              displayName={propTypes[key].displayName}
              settingName={key}
              value={settings[key]}
              propType={propTypes[key]}
              onChange={this._onValueChange.bind(this)}/>

          </div>)}
          <br />
          <div className="disclaimers">
          <em>*Green: Pickups *Blue: Drops *Red: High Intensity</em>
          <br />
          </div>
      </div>
    );
  }
}


const Setting = props => {
  const {propType} = props;
  if (propType && propType.type) {
    switch (propType.type) {
    case 'range':
      return <Slider {...props} />;

    case 'boolean':
      return <Checkbox {...props}/>;
    default:
      return <input {...props}/>;
    }
  }
};

const Checkbox = ({settingName, value, onChange, displayName}) => {
  return (


        <div className="input-group" >
        <input
          type="checkbox"
          id={settingName}
          checked={value}
          onChange={ e => onChange(settingName, e.target.checked) }/>
          <label>{displayName}</label>
      </div>



  );
};

const Slider = ({settingName, value, propType, displayName, onChange}) => {
  const {max = 100} = propType;
  return (
    <div>
      <label>{displayName}</label>
      <div style={{display: 'inline-block', float: 'right'}}>
        {value}
      </div>
    <div key={settingName}>
      <div className="input-group" >
        <div>
          <input
            type="range"
            id={settingName}
            min={0} max={max} step={max / 100}
            value={value}
            onChange={ e => onChange(settingName, Number(e.target.value)) }/>
        </div>
      </div>
    </div>
    </div>
  );
};
