// AnterosSelect.js

'use strict';

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Image,
  Text,
  ScrollView
} from 'react-native';

import { AnterosTheme } from '../../themes/AnterosTheme';
import { AnterosPullPicker } from '../PullPicker/AnterosPullPicker';
import { AnterosPopoverPicker } from '../PopoverPicker/AnterosPopoverPicker';
import { AnterosLocalDatasource, AnterosRemoteDatasource, dataSourceEvents } from "../Datasource/AnterosDatasource";
import shallowCompare from "react-addons-shallow-compare";

export class AnterosSelect extends Component {

  static propTypes = {
    ...TouchableOpacity.propTypes,
    dataSource: PropTypes.oneOfType([
      PropTypes.instanceOf(AnterosLocalDatasource),
      PropTypes.instanceOf(AnterosRemoteDatasource)
    ]),
    size: PropTypes.oneOf(['lg', 'md', 'sm']),
    value: PropTypes.any,
    valueStyle: Text.propTypes.style,
    items: PropTypes.array,
    getItemValue: PropTypes.func, //(item, index) ，item=items[index]
    getItemText: PropTypes.func, //(item, index) return display text of item, item=items[index], use item when it's null
    pickerType: PropTypes.oneOf(['auto', 'pull', 'popover']),
    pickerTitle: PropTypes.string, //PullPicker only
    editable: PropTypes.bool,
    icon: PropTypes.oneOfType([
      PropTypes.element, PropTypes.shape({ uri: PropTypes.string }),
      PropTypes.number,
      PropTypes.oneOf(['none', 'default'])
    ]),
    iconTintColor: PropTypes.string,
    placeholder: PropTypes.string,
    placeholderTextColor: PropTypes.string,
    onSelected: PropTypes.func, //(item, index)
  };

  static defaultProps = {
    ...TouchableOpacity.defaultProps,
    size: 'md',
    editable: true,
    icon: 'default',
    pickerType: 'auto'
  };


  constructor(props) {
    super(props);

    if (!this.props.dataSource && this.props.value) {
      this.state.value = this.props.value;
    } else if (this.props.dataSource) {
      if (!this.props.fieldText) {
        this.state.value = this.props.dataSource.fieldByName(this.props.dataField) ? this.props.dataSource.fieldByName(this.props.dataField) : ''
      } else {
        this.state.value = this.props.dataSource.fieldByName(this.props.dataField) ? this.props.dataSource.fieldByName(this.props.dataField)[this.props.fieldText] : ''
      }
    }
  }

  measureInWindow(callback) {
    this.refs.selectView && this
      .refs
      .selectView
      .measureInWindow(callback);
  }

  measure(callback) {
    this.refs.selectView && this
      .refs
      .selectView
      .measure(callback);
  }

  get selectedIndex() {
    let { value, items, getItemValue } = this.props;
    if (items instanceof Array) {
      if (getItemValue) {
        for (let i = 0; i < items.length; ++i) {
          if (getItemValue(items[i], i) === value)
            return i;
        }
      } else {
        for (let i = 0; i < items.length; ++i) {
          if (items[i] === value)
            return i;
        }
      }
    }
    return -1;
  }

  state = {
    value: ''
  }

  valueText = () => {
    let { value, items, getItemValue, getItemText } = this.props;
    let text = value;
    if (getItemText && items instanceof Array) {
      if (getItemValue) {
        for (let i = 0; i < items.length; ++i) {
          if (getItemValue(items[i], i) === value) {
            text = getItemText(items[i], i);
            break;
          }
        }
      } else {
        for (let i = 0; i < items.length; ++i) {
          if (items[i] === value) {
            text = getItemText(items[i], i);
            break;
          }
        }
      }
    }
    return (!text || React.isValidElement(text))
      ? text
      : `${text}`;
  }

  buildProps() {
    let {
      style,
      size,
      value,
      valueStyle,
      valueElement,
      disabled,
      iconTintColor,
      iconSize,
      placeholder,
      placeholderTextColor,
      onSelected,
      ...others
    } = this.props;

    //value
    value = this.props.onSelected ? this.props.value : this.state.value;
    //onSelected
    onSelected = this.onChangeSelect;


    //style
    let borderRadius,
      fontSize,
      paddingTop,
      paddingBottom,
      paddingLeft,
      paddingRight,
      height;
    switch (size) {
      case 'lg':
        borderRadius = AnterosTheme.selectBorderRadiusLG;
        fontSize = AnterosTheme.selectFontSizeLG;
        paddingTop = AnterosTheme.selectPaddingTopLG;
        paddingBottom = AnterosTheme.selectPaddingBottomLG;
        paddingLeft = AnterosTheme.selectPaddingLeftLG;
        paddingRight = AnterosTheme.selectPaddingRightLG;
        height = AnterosTheme.selectHeightLG;
        iconSize = AnterosTheme.selectIconSizeLG;
        break;
      case 'sm':
        borderRadius = AnterosTheme.selectBorderRadiusSM;
        fontSize = AnterosTheme.selectFontSizeSM;
        paddingTop = AnterosTheme.selectPaddingTopSM;
        paddingBottom = AnterosTheme.selectPaddingBottomSM;
        paddingLeft = AnterosTheme.selectPaddingLeftSM;
        paddingRight = AnterosTheme.selectPaddingRightSM;
        height = AnterosTheme.selectHeightSM;
        iconSize = AnterosTheme.selectIconSizeSM;
        break;
      default:
        borderRadius = AnterosTheme.selectBorderRadiusMD;
        fontSize = AnterosTheme.selectFontSizeMD;
        paddingTop = AnterosTheme.selectPaddingTopMD;
        paddingBottom = AnterosTheme.selectPaddingBottomMD;
        paddingLeft = AnterosTheme.selectPaddingLeftMD;
        paddingRight = AnterosTheme.selectPaddingRightMD;
        height = AnterosTheme.selectHeightMD;
        iconSize = AnterosTheme.selectIconSizeMD;
    }
    style = [
      {
        backgroundColor: AnterosTheme.selectColor,
        borderColor: AnterosTheme.selectBorderColor,
        borderWidth: AnterosTheme.selectBorderWidth,
        borderRadius: borderRadius,
        paddingTop: paddingTop,
        paddingBottom: paddingBottom,
        paddingLeft: paddingLeft,
        paddingRight: paddingRight,
        height: height
      }
    ]
      .concat(style)
      .concat({ flexDirection: 'row', alignItems: 'center' });
    if (disabled)
      style = style.concat({ opacity: AnterosTheme.btnDisabledOpacity });

    //value
    if (!placeholderTextColor)
      placeholderTextColor = AnterosTheme.selectPlaceholderTextColor;
    valueStyle = [
      {
        color: AnterosTheme.selectTextColor,
        fontSize: fontSize,
        flexGrow: 1,
        overflow: 'hidden'
      }
    ].concat(valueStyle);
    if (value === null || value === undefined) {
      valueStyle = valueStyle.concat({ color: placeholderTextColor });
      valueElement = <Text style={valueStyle} numberOfLines={this.props.numberOfLines ? this.props.numberOfLines : 1} allowFontScaling={false}>{placeholder}</Text>;
    } else {
      let valueText = value;
      if (React.isValidElement(valueText)) {
        valueElement = valueText;
      } else {
        valueElement = <Text style={valueStyle} numberOfLines={this.props.numberOfLines ? this.props.numberOfLines : 1} allowFontScaling={false}>{valueText}</Text>;
      }
    }

    //iconTintColor
    if (!iconTintColor)
      iconTintColor = AnterosTheme.selectIconTintColor;

    return {
      style,
      size,
      value,
      valueStyle,
      valueElement,
      disabled,
      iconTintColor,
      iconSize,
      placeholder,
      placeholderTextColor,
      onSelected,
      ...others
    };
  }

  showPullPicker() {
    const props = this.buildProps();
    let { pickerTitle, items, getItemText, onSelected } = props;
    let its;
    if (!getItemText) {
      its = items.map(item => {
        return item[props.fieldText]
      })
    }
    AnterosPullPicker.show(pickerTitle, !getItemText ? its : items, this.selectedIndex, onSelected, { getItemText }, props.pickerTitleStyle, props.popupHeight);
  }

  showPopoverPicker() {
    const props = this.buildProps();
    this.measure((x, y, width, height, pageX, pageY) => {
      let { items, getItemText, onSelected } = props;
      let its = items.map(item => {
        return item.text
      })
      AnterosPopoverPicker.show({
        x: pageX,
        y: pageY,
        width,
        height
      }, its, this.selectedIndex, onSelected, { getItemText, align: 'end' });
    });
  }

  showPicker() {
    const props = this.buildProps();
    switch (this.props.pickerType) {
      case 'pull':
        this.showPullPicker(props);
        break;
      case 'popover':
        this.showPopoverPicker(props);
        break;
      default:
        AnterosTheme.isPad
          ? this.showPopoverPicker(props)
          : this.showPullPicker(props);
        break;
    }
  }

  renderIconElement(props) {
    let { icon, iconTintColor, iconSize } = props;
    let iconElement;
    if (icon === null || icon === undefined || icon === 'none') {
      iconElement = null;
    } else if (React.isValidElement(icon)) {
      iconElement = icon;
    } else {
      iconElement = (<Image
        style={{
          width: iconSize,
          height: iconSize,
          tintColor: iconTintColor
        }}
        source={icon === 'default'
          ? require('../../assets/icons/select.png')
          : icon} />);
    }
    return iconElement;
  }

  onChangeSelect = (newValue) => {
    if (this.props.dataSource) {
      let valor;
      this.props.items.map(item => {
        if (typeof (item) === "string") {
          valor = newValue
          this.props.dataSource.setFieldByName(this.props.dataField, valor);
        } else {
          if (item[this.props.fieldText] === newValue[this.props.fieldText] || item[this.props.fieldText] === newValue) {
            this.props.dataSource.setFieldByName(this.props.dataField, item);
            valor = this.props.dataSource.fieldByName(this.props.dataField)
            if (valor){
              valor = valor[this.props.fieldText];
            }
          }
        }
      })
      this.setState({ value: valor });
    } else {
      this.setState({ value: newValue });
    }

    if (this.props.onSelected){
      this.props.onSelected(newValue);
    }

  }

  UNSAFE_componentWillReceiveProps(nextProps) {
    if (nextProps.dataSource) {
      let value = nextProps.dataSource.fieldByName(this.props.dataField);
      if (!value) {
        value = '';
      }
    }
  }

  shouldComponentUpdate=(nextProps, nextState) => {
    return shallowCompare(this, nextProps, nextState);
  }

  componentDidMount() {
    if (this.props.dataSource) {
      this.props.dataSource.addEventListener(
        [dataSourceEvents.AFTER_CLOSE,
        dataSourceEvents.AFTER_OPEN,
        dataSourceEvents.AFTER_GOTO_PAGE,
        dataSourceEvents.AFTER_CANCEL,
        dataSourceEvents.AFTER_SCROLL], this.onDatasourceEvent);
      this.props.dataSource.addEventListener(dataSourceEvents.DATA_FIELD_CHANGED, this.onDatasourceEvent, this.props.dataField);
    }
  }

  componentWillUnmount() {

    if ((this.props.dataSource)) {
      this.props.dataSource.removeEventListener(
        [dataSourceEvents.AFTER_CLOSE,
        dataSourceEvents.AFTER_OPEN,
        dataSourceEvents.AFTER_GOTO_PAGE,
        dataSourceEvents.AFTER_CANCEL,
        dataSourceEvents.AFTER_SCROLL], this.onDatasourceEvent);
      this.props.dataSource.removeEventListener(dataSourceEvents.DATA_FIELD_CHANGED, this.onDatasourceEvent, this.props.dataField);
    }
  }

  onDatasourceEvent=(event, error) => {
    if (this.props.dataSource && this.props.dataField){
      let valor = this.props.dataSource.fieldByName(this.props.dataField)
      if (valor){
        valor = valor[this.props.fieldText];
        if (valor !== this.state.value){
          this.setState({value: valor});
        }
      }
    }
  }


  render() {
    const props = this.buildProps();

    let {
      style,
      disabled,
      icon,
      iconTintColor,
      editable,
      iconSize,
      valueElement,
      children,
      onPress,
      onLayout,
      ...others
    } = props;
    let ViewClass = disabled
      ? View
      : TouchableOpacity;


    return (
      <ViewClass
        style={style}
        disabled={disabled || !editable}
        onPress={e => onPress
          ? onPress(e)
          : this.showPicker()}
        onLayout={e => {
          this.measure((x, y, width, height, pageX, pageY) => {
            this.popoverView && this
              .popoverView
              .updateFromBounds({ x: pageX, y: pageY, width, height });
          });
          onLayout && onLayout(e);
        }}
        {...others}
        ref='selectView'>
        {valueElement}
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            right: 0,
            justifyContent: 'center'
          }}>
          {this.renderIconElement(props)}
        </View>
      </ViewClass>
    );
  }
}
