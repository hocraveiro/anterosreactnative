import React,{ PureComponent, Component } from 'react';
import { Animated, Easing, FlatList, I18nManager, Platform, 
    StyleSheet, TouchableOpacity, ScrollView, View, ViewPropTypes } from 'react-native';
import PropTypes from 'prop-types';
import shallowCompare from 'react-addons-shallow-compare';


const IS_IOS = Platform.OS === 'ios';
const IS_ANDROID = Platform.OS === 'android';

// Native driver for scroll events
// See: https://facebook.github.io/react-native/blog/2017/02/14/using-native-driver-for-animated.html
const AnimatedFlatList = FlatList ? Animated.createAnimatedComponent(FlatList) : null;
const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

// React Native automatically handles RTL layouts; unfortunately, it's buggy with horizontal ScrollView
// See https://github.com/facebook/react-native/issues/11960
// NOTE: the following variable is not declared in the constructor
// otherwise it is undefined at init, which messes with custom indexes
const IS_RTL = I18nManager.isRTL;

export class AnterosAdvancedCarousel extends Component {

    static propTypes = {
        data: PropTypes.array.isRequired,
        renderItem: PropTypes.func.isRequired,
        itemWidth: PropTypes.number, // required for horizontal carousel
        itemHeight: PropTypes.number, // required for vertical carousel
        sliderWidth: PropTypes.number, // required for horizontal carousel
        sliderHeight: PropTypes.number, // required for vertical carousel
        activeAnimationType: PropTypes.string,
        activeAnimationOptions: PropTypes.object,
        activeSlideAlignment: PropTypes.oneOf(['center', 'end', 'start']),
        activeSlideOffset: PropTypes.number,
        apparitionDelay: PropTypes.number,
        autoplay: PropTypes.bool,
        autoplayDelay: PropTypes.number,
        autoplayInterval: PropTypes.number,
        callbackOffsetMargin: PropTypes.number,
        containerCustomStyle: ViewPropTypes ? ViewPropTypes.style : View.propTypes.style,
        contentContainerCustomStyle: ViewPropTypes ? ViewPropTypes.style : View.propTypes.style,
        enableMomentum: PropTypes.bool,
        enableSnap: PropTypes.bool,
        firstItem: PropTypes.number,
        hasParallaxImages: PropTypes.bool,
        inactiveSlideOpacity: PropTypes.number,
        inactiveSlideScale: PropTypes.number,
        inactiveSlideShift: PropTypes.number,
        layout: PropTypes.oneOf(['default', 'stack', 'tinder']),
        layoutCardOffset: PropTypes.number,
        lockScrollTimeoutDuration: PropTypes.number,
        lockScrollWhileSnapping: PropTypes.bool,
        loop: PropTypes.bool,
        loopClonesPerSide: PropTypes.number,
        scrollInterpolator: PropTypes.func,
        slideInterpolatedStyle: PropTypes.func,
        slideStyle: PropTypes.any,
        shouldOptimizeUpdates: PropTypes.bool,
        swipeThreshold: PropTypes.number,
        useScrollView: PropTypes.bool,
        vertical: PropTypes.bool,
        onBeforeSnapToItem: PropTypes.func,
        onSnapToItem: PropTypes.func
    };

    static defaultProps = {
        activeAnimationType: 'timing',
        activeAnimationOptions: null,
        activeSlideAlignment: 'center',
        activeSlideOffset: 20,
        apparitionDelay: 0,
        autoplay: false,
        autoplayDelay: 5000,
        autoplayInterval: 3000,
        callbackOffsetMargin: 5,
        containerCustomStyle: {},
        contentContainerCustomStyle: {},
        enableMomentum: false,
        enableSnap: true,
        firstItem: 0,
        hasParallaxImages: false,
        inactiveSlideOpacity: 0.7,
        inactiveSlideScale: 0.9,
        inactiveSlideShift: 0,
        layout: 'default',
        lockScrollTimeoutDuration: 1000,
        lockScrollWhileSnapping: false,
        loop: false,
        loopClonesPerSide: 3,
        slideStyle: {},
        shouldOptimizeUpdates: true,
        swipeThreshold: 20,
        useScrollView: !AnimatedFlatList,
        vertical: false
    }

    constructor (props) {
        super(props);

        this.state = {
            hideCarousel: true,
            interpolators: []
        };

        // The following values are not stored in the state because 'setState()' is asynchronous
        // and this results in an absolutely crappy behavior on Android while swiping (see #156)
        const initialActiveItem = this._getFirstItem(props.firstItem);
        this._activeItem = initialActiveItem;
        this._previousActiveItem = initialActiveItem;
        this._previousFirstItem = initialActiveItem;
        this._previousItemsLength = initialActiveItem;

        this._mounted = false;
        this._positions = [];
        this._currentContentOffset = 0; // store ScrollView's scroll position
        this._canFireBeforeCallback = false;
        this._canFireCallback = false;
        this._scrollOffsetRef = null;
        this._onScrollTriggered = true; // used when momentum is enabled to prevent an issue with edges items
        this._lastScrollDate = 0; // used to work around a FlatList bug
        this._scrollEnabled = props.scrollEnabled === false ? false : true;

        this._initPositionsAndInterpolators = this._initPositionsAndInterpolators.bind(this);
        this._renderItem = this._renderItem.bind(this);
        this._onSnap = this._onSnap.bind(this);

        this._onLayout = this._onLayout.bind(this);
        this._onScroll = this._onScroll.bind(this);
        this._onScrollBeginDrag = props.enableSnap ? this._onScrollBeginDrag.bind(this) : undefined;
        this._onScrollEnd = props.enableSnap || props.autoplay ? this._onScrollEnd.bind(this) : undefined;
        this._onScrollEndDrag = !props.enableMomentum ? this._onScrollEndDrag.bind(this) : undefined;
        this._onMomentumScrollEnd = props.enableMomentum ? this._onMomentumScrollEnd.bind(this) : undefined;
        this._onTouchStart = this._onTouchStart.bind(this);
        this._onTouchRelease = this._onTouchRelease.bind(this);

        this._getKeyExtractor = this._getKeyExtractor.bind(this);

        // Native driver for scroll events
        const scrollEventConfig = {
            listener: this._onScroll,
            useNativeDriver: true
        };
        this._scrollPos = new Animated.Value(0);
        this._onScrollHandler = props.vertical ?
            Animated.event(
                [{ nativeEvent: { contentOffset: { y: this._scrollPos } } }],
                scrollEventConfig
            ) : Animated.event(
                [{ nativeEvent: { contentOffset: { x: this._scrollPos } } }],
                scrollEventConfig
            );

        // This bool aims at fixing an iOS bug due to scrollTo that triggers onMomentumScrollEnd.
        // onMomentumScrollEnd fires this._snapScroll, thus creating an infinite loop.
        this._ignoreNextMomentum = false;

        // Warnings
        if (!ViewPropTypes) {
            console.warn('react-native-snap-carousel: It is recommended to use at least version 0.44 of React Native with the plugin');
        }
        if (!props.vertical && (!props.sliderWidth || !props.itemWidth)) {
            console.warn('react-native-snap-carousel: You need to specify both `sliderWidth` and `itemWidth` for horizontal carousels');
        }
        if (props.vertical && (!props.sliderHeight || !props.itemHeight)) {
            console.warn('react-native-snap-carousel: You need to specify both `sliderHeight` and `itemHeight` for vertical carousels');
        }
        if (props.apparitionDelay && !IS_IOS && !props.useScrollView) {
            console.warn('react-native-snap-carousel: Using `apparitionDelay` on Android is not recommended since it can lead to rendering issues');
        }
        if (props.customAnimationType || props.customAnimationOptions) {
            console.warn('react-native-snap-carousel: Props `customAnimationType` and `customAnimationOptions` have been renamed to `activeAnimationType` and `activeAnimationOptions`');
        }
        if (props.onScrollViewScroll) {
            console.warn('react-native-snap-carousel: Prop `onScrollViewScroll` has been removed. Use `onScroll` instead');
        }
    }

    componentDidMount () {
        const { apparitionDelay, autoplay, firstItem } = this.props;
        const _firstItem = this._getFirstItem(firstItem);
        const apparitionCallback = () => {
            this.setState({ hideCarousel: false });
            if (autoplay) {
                this.startAutoplay();
            }
        };

        this._mounted = true;
        this._initPositionsAndInterpolators();

        // Without 'requestAnimationFrame' or a `0` timeout, images will randomly not be rendered on Android...
        requestAnimationFrame(() => {
            if (!this._mounted) {
                return;
            }

            this._snapToItem(_firstItem, false, false, true, false);
            this._hackActiveSlideAnimation(_firstItem, 'start', true);

            if (apparitionDelay) {
                this._apparitionTimeout = setTimeout(() => {
                    apparitionCallback();
                }, apparitionDelay);
            } else {
                apparitionCallback();
            }
        });
    }

    shouldComponentUpdate (nextProps, nextState) {
        if (this.props.shouldOptimizeUpdates === false) {
            return true;
        } else {
            return shallowCompare(this, nextProps, nextState);
        }
    }

    UNSAFE_componentWillReceiveProps (nextProps) {
        const { interpolators } = this.state;
        const { firstItem, itemHeight, itemWidth, scrollEnabled, sliderHeight, sliderWidth } = nextProps;
        const itemsLength = this._getCustomDataLength(nextProps);

        if (!itemsLength) {
            return;
        }

        const nextFirstItem = this._getFirstItem(firstItem, nextProps);
        let nextActiveItem = this._activeItem || this._activeItem === 0 ? this._activeItem : nextFirstItem;

        const hasNewSliderWidth = sliderWidth && sliderWidth !== this.props.sliderWidth;
        const hasNewSliderHeight = sliderHeight && sliderHeight !== this.props.sliderHeight;
        const hasNewItemWidth = itemWidth && itemWidth !== this.props.itemWidth;
        const hasNewItemHeight = itemHeight && itemHeight !== this.props.itemHeight;
        const hasNewScrollEnabled = scrollEnabled !== this.props.scrollEnabled;

        // Prevent issues with dynamically removed items
        if (nextActiveItem > itemsLength - 1) {
            nextActiveItem = itemsLength - 1;
        }

        // Handle changing scrollEnabled independent of user -> carousel interaction
        if (hasNewScrollEnabled) {
            this._setScrollEnabled(scrollEnabled);
        }

        if (interpolators.length !== itemsLength || hasNewSliderWidth ||
            hasNewSliderHeight || hasNewItemWidth || hasNewItemHeight) {
            this._activeItem = nextActiveItem;
            this._previousItemsLength = itemsLength;

            this._initPositionsAndInterpolators(nextProps);

            // Handle scroll issue when dynamically removing items (see #133)
            // This also fixes first item's active state on Android
            // Because 'initialScrollIndex' apparently doesn't trigger scroll
            if (this._previousItemsLength > itemsLength) {
                this._hackActiveSlideAnimation(nextActiveItem, null, true);
            }

            if (hasNewSliderWidth || hasNewSliderHeight || hasNewItemWidth || hasNewItemHeight) {
                this._snapToItem(nextActiveItem, false, false, false, false);
            }
        } else if (nextFirstItem !== this._previousFirstItem && nextFirstItem !== this._activeItem) {
            this._activeItem = nextFirstItem;
            this._previousFirstItem = nextFirstItem;
            this._snapToItem(nextFirstItem, true, true, false, false);
        }
    }

    componentWillUnmount () {
        this._mounted = false;
        this.stopAutoplay();
        clearTimeout(this._apparitionTimeout);
        clearTimeout(this._hackSlideAnimationTimeout);
        clearTimeout(this._enableAutoplayTimeout);
        clearTimeout(this._autoplayTimeout);
        clearTimeout(this._snapNoMomentumTimeout);
        clearTimeout(this._edgeItemTimeout);
        clearTimeout(this._lockScrollTimeout);
    }

    get realIndex () {
        return this._activeItem;
    }

    get currentIndex () {
        return this._getDataIndex(this._activeItem);
    }

    get currentScrollPosition () {
        return this._currentContentOffset;
    }

    _needsScrollView () {
        const { useScrollView } = this.props;
        return useScrollView || !AnimatedFlatList || this._shouldUseStackLayout() || this._shouldUseTinderLayout();
    }

    _needsRTLAdaptations () {
        const { vertical } = this.props;
        return IS_RTL && !IS_IOS && !vertical;
    }

    _canLockScroll () {
        const { enableMomentum, lockScrollWhileSnapping } = this.props;
        return !enableMomentum && lockScrollWhileSnapping;
    }

    _enableLoop () {
        const { data, enableSnap, loop } = this.props;
        return enableSnap && loop && data.length && data.length > 1;
    }

    _shouldAnimateSlides (props = this.props) {
        const { inactiveSlideOpacity, inactiveSlideScale, scrollInterpolator, slideInterpolatedStyle } = props;
        return inactiveSlideOpacity < 1 ||
            inactiveSlideScale < 1 ||
            !!scrollInterpolator ||
            !!slideInterpolatedStyle ||
            this._shouldUseShiftLayout() ||
            this._shouldUseStackLayout() ||
            this._shouldUseTinderLayout();
    }

    _shouldUseCustomAnimation () {
        const { activeAnimationOptions } = this.props;
        return !!activeAnimationOptions && !this._shouldUseStackLayout() && !this._shouldUseTinderLayout();
    }

    _shouldUseShiftLayout () {
        const { inactiveSlideShift, layout } = this.props;
        return layout === 'default' && inactiveSlideShift !== 0;
    }

    _shouldUseStackLayout () {
        return this.props.layout === 'stack';
    }

    _shouldUseTinderLayout () {
        return this.props.layout === 'tinder';
    }

    _getCustomData (props = this.props) {
        const { data, loopClonesPerSide } = props;
        const dataLength = data.length;

        if (!data || !dataLength) {
            return [];
        }

        if (!this._enableLoop()) {
            return data;
        }

        let previousItems = [];
        let nextItems = [];

        if (loopClonesPerSide > dataLength) {
            const dataMultiplier = Math.floor(loopClonesPerSide / dataLength);
            const remainder = loopClonesPerSide % dataLength;

            for (let i = 0; i < dataMultiplier; i++) {
                previousItems.push(...data);
                nextItems.push(...data);
            }

            previousItems.unshift(...data.slice(-remainder));
            nextItems.push(...data.slice(0, remainder));
        } else {
            previousItems = data.slice(-loopClonesPerSide);
            nextItems = data.slice(0, loopClonesPerSide);
        }

        return previousItems.concat(data, nextItems);
    }

    _getCustomDataLength (props = this.props) {
        const { data, loopClonesPerSide } = props;
        const dataLength = data && data.length;

        if (!dataLength) {
            return 0;
        }

        return this._enableLoop() ? dataLength + (2 * loopClonesPerSide) : dataLength;
    }

    _getCustomIndex (index, props = this.props) {
        const itemsLength = this._getCustomDataLength(props);

        if (!itemsLength || (!index && index !== 0)) {
            return 0;
        }

        return this._needsRTLAdaptations() ? itemsLength - index - 1 : index;
    }

    _getDataIndex (index) {
        const { data, loopClonesPerSide } = this.props;
        const dataLength = data && data.length;

        if (!this._enableLoop() || !dataLength) {
            return index;
        }

        if (index >= dataLength + loopClonesPerSide) {
            return loopClonesPerSide > dataLength ?
                (index - loopClonesPerSide) % dataLength :
                index - dataLength - loopClonesPerSide;
        } else if (index < loopClonesPerSide) {
            // TODO: is there a simpler way of determining the interpolated index?
            if (loopClonesPerSide > dataLength) {
                const baseDataIndexes = [];
                const dataIndexes = [];
                const dataMultiplier = Math.floor(loopClonesPerSide / dataLength);
                const remainder = loopClonesPerSide % dataLength;

                for (let i = 0; i < dataLength; i++) {
                    baseDataIndexes.push(i);
                }

                for (let j = 0; j < dataMultiplier; j++) {
                    dataIndexes.push(...baseDataIndexes);
                }

                dataIndexes.unshift(...baseDataIndexes.slice(-remainder));
                return dataIndexes[index];
            } else {
                return index + dataLength - loopClonesPerSide;
            }
        } else {
            return index - loopClonesPerSide;
        }
    }

    // Used with `snapToItem()` and 'PaginationDot'
    _getPositionIndex (index) {
        const { loop, loopClonesPerSide } = this.props;
        return loop ? index + loopClonesPerSide : index;
    }

    _getFirstItem (index, props = this.props) {
        const { loopClonesPerSide } = props;
        const itemsLength = this._getCustomDataLength(props);

        if (!itemsLength || index > itemsLength - 1 || index < 0) {
            return 0;
        }

        return this._enableLoop() ? index + loopClonesPerSide : index;
    }

    _getWrappedRef () {
        // https://github.com/facebook/react-native/issues/10635
        // https://stackoverflow.com/a/48786374/8412141
        return this._carouselRef && this._carouselRef.getNode && this._carouselRef.getNode();
    }

    _getScrollEnabled () {
        return this._scrollEnabled;
    }

    _setScrollEnabled (value = true) {
        const { scrollEnabled } = this.props;
        const wrappedRef = this._getWrappedRef();

        if (!wrappedRef || !wrappedRef.setNativeProps) {
            return;
        }

        // 'setNativeProps()' is used instead of 'setState()' because the latter
        // really takes a toll on Android behavior when momentum is disabled
        wrappedRef.setNativeProps({ scrollEnabled: value });
        this._scrollEnabled = value;
    }

    _getKeyExtractor (item, index) {
        return this._needsScrollView() ? `scrollview-item-${index}` : `flatlist-item-${index}`;
    }

    _getScrollOffset (event) {
        const { vertical } = this.props;
        return (event && event.nativeEvent && event.nativeEvent.contentOffset &&
            Math.round(event.nativeEvent.contentOffset[vertical ? 'y' : 'x'])) || 0;
    }

    _getContainerInnerMargin (opposite = false) {
        const { sliderWidth, sliderHeight, itemWidth, itemHeight, vertical, activeSlideAlignment } = this.props;

        if ((activeSlideAlignment === 'start' && !opposite) ||
            (activeSlideAlignment === 'end' && opposite)) {
            return 0;
        } else if ((activeSlideAlignment === 'end' && !opposite) ||
            (activeSlideAlignment === 'start' && opposite)) {
            return vertical ? sliderHeight - itemHeight : sliderWidth - itemWidth;
        } else {
            return vertical ? (sliderHeight - itemHeight) / 2 : (sliderWidth - itemWidth) / 2;
        }
    }

    _getViewportOffet () {
        const { sliderWidth, sliderHeight, itemWidth, itemHeight, vertical, activeSlideAlignment } = this.props;

        if (activeSlideAlignment === 'start') {
            return vertical ? itemHeight / 2 : itemWidth / 2;
        } else if (activeSlideAlignment === 'end') {
            return vertical ?
                sliderHeight - (itemHeight / 2) :
                sliderWidth - (itemWidth / 2);
        } else {
            return vertical ? sliderHeight / 2 : sliderWidth / 2;
        }
    }

    _getCenter (offset) {
        return offset + this._getViewportOffet() - this._getContainerInnerMargin();
    }

    _getActiveItem (offset) {
        const { activeSlideOffset, swipeThreshold } = this.props;
        const center = this._getCenter(offset);
        const centerOffset = activeSlideOffset || swipeThreshold;

        for (let i = 0; i < this._positions.length; i++) {
            const { start, end } = this._positions[i];
            if (center + centerOffset >= start && center - centerOffset <= end) {
                return i;
            }
        }

        const lastIndex = this._positions.length - 1;
        if (this._positions[lastIndex] && center - centerOffset > this._positions[lastIndex].end) {
            return lastIndex;
        }

        return 0;
    }

    _initPositionsAndInterpolators (props = this.props) {
        const { data, itemWidth, itemHeight, scrollInterpolator, vertical } = props;
        const sizeRef = vertical ? itemHeight : itemWidth;

        if (!data.length) {
            return;
        }

        let interpolators = [];
        this._positions = [];

        this._getCustomData(props).forEach((itemData, index) => {
            const _index = this._getCustomIndex(index, props);
            let animatedValue;

            this._positions[index] = {
                start: index * sizeRef,
                end: index * sizeRef + sizeRef
            };

            if (!this._shouldAnimateSlides(props)) {
                animatedValue = 1;
            } else if (this._shouldUseCustomAnimation()) {
                animatedValue = new Animated.Value(_index === this._activeItem ? 1 : 0);
            } else {
                let interpolator;

                if (scrollInterpolator) {
                    interpolator = scrollInterpolator(_index, props);
                } else if (this._shouldUseStackLayout()) {
                    interpolator = stackScrollInterpolator(_index, props);
                } else if (this._shouldUseTinderLayout()) {
                    interpolator = tinderScrollInterpolator(_index, props);
                }

                if (!interpolator || !interpolator.inputRange || !interpolator.outputRange) {
                    interpolator = defaultScrollInterpolator(_index, props);
                }

                animatedValue = this._scrollPos.interpolate({
                    ...interpolator,
                    extrapolate: 'clamp'
                });
            }

            interpolators.push(animatedValue);
        });

        this.setState({ interpolators });
    }

    _getSlideAnimation (index, toValue) {
        const { interpolators } = this.state;
        const { activeAnimationType, activeAnimationOptions } = this.props;

        const animatedValue = interpolators && interpolators[index];

        if (!animatedValue && animatedValue !== 0) {
            return false;
        }

        const animationCommonOptions = {
            isInteraction: false,
            useNativeDriver: true,
            ...activeAnimationOptions,
            toValue: toValue
        };

        return Animated.parallel([
            Animated['timing'](
                animatedValue,
                { ...animationCommonOptions, easing: Easing.linear }
            ),
            Animated[activeAnimationType](
                animatedValue,
                { ...animationCommonOptions }
            )
        ]);
    }

    _playCustomSlideAnimation (current, next) {
        const { interpolators } = this.state;
        const itemsLength = this._getCustomDataLength();
        const _currentIndex = this._getCustomIndex(current);
        const _currentDataIndex = this._getDataIndex(_currentIndex);
        const _nextIndex = this._getCustomIndex(next);
        const _nextDataIndex = this._getDataIndex(_nextIndex);
        let animations = [];

        // Keep animations in sync when looping
        if (this._enableLoop()) {
            for (let i = 0; i < itemsLength; i++) {
                if (this._getDataIndex(i) === _currentDataIndex && interpolators[i]) {
                    animations.push(this._getSlideAnimation(i, 0));
                } else if (this._getDataIndex(i) === _nextDataIndex && interpolators[i]) {
                    animations.push(this._getSlideAnimation(i, 1));
                }
            }
        } else {
            if (interpolators[current]) {
                animations.push(this._getSlideAnimation(current, 0));
            }
            if (interpolators[next]) {
                animations.push(this._getSlideAnimation(next, 1));
            }
        }

        Animated.parallel(animations, { stopTogether: false }).start();
    }

    _hackActiveSlideAnimation (index, goTo, force = false) {
        const { data } = this.props;

        if (!this._mounted || !this._carouselRef || !this._positions[index] || (!force && this._enableLoop())) {
            return;
        }

        const offset = this._positions[index] && this._positions[index].start;

        if (!offset && offset !== 0) {
            return;
        }

        const itemsLength = data && data.length;
        const direction = goTo || itemsLength === 1 ? 'start' : 'end';

        this._scrollTo(offset + (direction === 'start' ? -1 : 1), false);

        clearTimeout(this._hackSlideAnimationTimeout);
        this._hackSlideAnimationTimeout = setTimeout(() => {
            this._scrollTo(offset, false);
        }, 50); // works randomly when set to '0'
    }

    _lockScroll () {
        const { lockScrollTimeoutDuration } = this.props;
        clearTimeout(this._lockScrollTimeout);
        this._lockScrollTimeout = setTimeout(() => {
            this._releaseScroll();
        }, lockScrollTimeoutDuration);
        this._setScrollEnabled(false);
    }

    _releaseScroll () {
        clearTimeout(this._lockScrollTimeout);
        this._setScrollEnabled(true);
    }

    _repositionScroll (index) {
        const { data, loopClonesPerSide } = this.props;
        const dataLength = data && data.length;

        if (!this._enableLoop() || !dataLength ||
            (index >= loopClonesPerSide && index < dataLength + loopClonesPerSide)) {
            return;
        }

        let repositionTo = index;

        if (index >= dataLength + loopClonesPerSide) {
            repositionTo = index - dataLength;
        } else if (index < loopClonesPerSide) {
            repositionTo = index + dataLength;
        }

        this._snapToItem(repositionTo, false, false, false, false);
    }

    _scrollTo (offset, animated = true) {
        const { vertical } = this.props;
        const wrappedRef = this._getWrappedRef();

        if (!this._mounted || !wrappedRef) {
            return;
        }

        const specificOptions = this._needsScrollView() ? {
            x: vertical ? 0 : offset,
            y: vertical ? offset : 0
        } : {
            offset
        };
        const options = {
            ...specificOptions,
            animated
        };

        if (this._needsScrollView()) {
            wrappedRef.scrollTo(options);
        } else {
            wrappedRef.scrollToOffset(options);
        }
    }

    _onScroll (event) {
        const { callbackOffsetMargin, enableMomentum, onScroll } = this.props;

        const scrollOffset = event ? this._getScrollOffset(event) : this._currentContentOffset;
        const nextActiveItem = this._getActiveItem(scrollOffset);
        const itemReached = nextActiveItem === this._itemToSnapTo;
        const scrollConditions =
            scrollOffset >= this._scrollOffsetRef - callbackOffsetMargin &&
            scrollOffset <= this._scrollOffsetRef + callbackOffsetMargin;

        this._currentContentOffset = scrollOffset;
        this._onScrollTriggered = true;
        this._lastScrollDate = Date.now();

        if (this._activeItem !== nextActiveItem && this._shouldUseCustomAnimation()) {
            this._playCustomSlideAnimation(this._activeItem, nextActiveItem);
        }

        if (enableMomentum) {
            clearTimeout(this._snapNoMomentumTimeout);

            if (this._activeItem !== nextActiveItem) {
                this._activeItem = nextActiveItem;
            }


            if (itemReached) {
                if (this._canFireBeforeCallback) {
                    this._onBeforeSnap(this._getDataIndex(nextActiveItem));
                }

                if (scrollConditions && this._canFireCallback) {
                    this._onSnap(this._getDataIndex(nextActiveItem));
                }
            }
        } else if (this._activeItem !== nextActiveItem && itemReached) {
            if (this._canFireBeforeCallback) {
                this._onBeforeSnap(this._getDataIndex(nextActiveItem));
            }

            if (scrollConditions) {
                this._activeItem = nextActiveItem;

                if (this._canLockScroll()) {
                    this._releaseScroll();
                }

                if (this._canFireCallback) {
                    this._onSnap(this._getDataIndex(nextActiveItem));
                }
            }
        }

        if (nextActiveItem === this._itemToSnapTo &&
            scrollOffset === this._scrollOffsetRef) {
            this._repositionScroll(nextActiveItem);
        }

        if (onScroll && event) {
            onScroll(event);
        }
    }

    _onStartShouldSetResponderCapture (event) {
        const { onStartShouldSetResponderCapture } = this.props;

        if (onStartShouldSetResponderCapture) {
            onStartShouldSetResponderCapture(event);
        }

        return this._getScrollEnabled();
    }

    _onTouchStart () {
        // `onTouchStart` is fired even when `scrollEnabled` is set to `false`
        if (this._getScrollEnabled() !== false && this._autoplaying) {
            this.stopAutoplay();
        }
    }

    // Used when `enableSnap` is ENABLED
    _onScrollBeginDrag (event) {
        const { onScrollBeginDrag } = this.props;

        if (!this._getScrollEnabled()) {
            return;
        }

        this._scrollStartOffset = this._getScrollOffset(event);
        this._scrollStartActive = this._getActiveItem(this._scrollStartOffset);
        this._ignoreNextMomentum = false;
        // this._canFireCallback = false;

        if (onScrollBeginDrag) {
            onScrollBeginDrag(event);
        }
    }

    // Used when `enableMomentum` is DISABLED
    _onScrollEndDrag (event) {
        const { onScrollEndDrag } = this.props;

        if (this._carouselRef) {
            this._onScrollEnd && this._onScrollEnd();
        }

        if (onScrollEndDrag) {
            onScrollEndDrag(event);
        }
    }

    // Used when `enableMomentum` is ENABLED
    _onMomentumScrollEnd (event) {
        const { onMomentumScrollEnd } = this.props;

        if (this._carouselRef) {
            this._onScrollEnd && this._onScrollEnd();
        }

        if (onMomentumScrollEnd) {
            onMomentumScrollEnd(event);
        }
    }

    _onScrollEnd (event) {
        const { autoplay, enableSnap } = this.props;

        if (this._ignoreNextMomentum) {
            // iOS fix
            this._ignoreNextMomentum = false;
            return;
        }

        this._scrollEndOffset = this._currentContentOffset;
        this._scrollEndActive = this._getActiveItem(this._scrollEndOffset);

        if (enableSnap) {
            this._snapScroll(this._scrollEndOffset - this._scrollStartOffset);
        }

        if (autoplay) {
            // Restart autoplay after a little while
            // This could be done when releasing touch
            // but the event is buggy on Android...
            // https://github.com/facebook/react-native/issues/9439
            clearTimeout(this._enableAutoplayTimeout);
            this._enableAutoplayTimeout = setTimeout(() => {
                this.startAutoplay();
            }, 300);
        }
    }

    // Due to a bug, this event is only fired on iOS
    // https://github.com/facebook/react-native/issues/6791
    // it's fine since we're only fixing an iOS bug in it, so ...
    _onTouchRelease (event) {
        const { enableMomentum } = this.props;

        if (enableMomentum && IS_IOS) {
            clearTimeout(this._snapNoMomentumTimeout);
            this._snapNoMomentumTimeout = setTimeout(() => {
                this._snapToItem(this._activeItem);
            }, 100);
        }
    }

    _onLayout (event) {
        const { onLayout } = this.props;

        // Prevent unneeded actions during the first 'onLayout' (triggered on init)
        if (this._onLayoutInitDone) {
            this._initPositionsAndInterpolators();
            this._snapToItem(this._activeItem, false, false, false, false);
        } else {
            this._onLayoutInitDone = true;
        }

        if (onLayout) {
            onLayout(event);
        }
    }

    _snapScroll (delta) {
        const { swipeThreshold } = this.props;

        // When using momentum and releasing the touch with
        // no velocity, scrollEndActive will be undefined (iOS)
        if (!this._scrollEndActive && this._scrollEndActive !== 0 && IS_IOS) {
            this._scrollEndActive = this._scrollStartActive;
        }

        if (this._scrollStartActive !== this._scrollEndActive) {
            // Snap to the new active item
            this._snapToItem(this._scrollEndActive);
        } else {
            // Snap depending on delta
            if (delta > 0) {
                if (delta > swipeThreshold) {
                    this._snapToItem(this._scrollStartActive + 1);
                } else {
                    this._snapToItem(this._scrollEndActive);
                }
            } else if (delta < 0) {
                if (delta < -swipeThreshold) {
                    this._snapToItem(this._scrollStartActive - 1);
                } else {
                    this._snapToItem(this._scrollEndActive);
                }
            } else {
                // Snap to current
                this._snapToItem(this._scrollEndActive);
            }
        }
    }

    _snapToItem (index, animated = true, fireCallback = true, initial = false, lockScroll = true) {
        const { enableMomentum, onSnapToItem, onBeforeSnapToItem } = this.props;
        const itemsLength = this._getCustomDataLength();
        const wrappedRef = this._getWrappedRef();

        if (!itemsLength || !wrappedRef) {
            return;
        }

        if (!index || index < 0) {
            index = 0;
        } else if (itemsLength > 0 && index >= itemsLength) {
            index = itemsLength - 1;
        }

        if (index !== this._previousActiveItem) {
            this._previousActiveItem = index;

            // Placed here to allow overscrolling for edges items
            if (lockScroll && this._canLockScroll()) {
                this._lockScroll();
            }

            if (fireCallback) {
                if (onBeforeSnapToItem) {
                    this._canFireBeforeCallback = true;
                }

                if (onSnapToItem) {
                    this._canFireCallback = true;
                }
            }
        }

        this._itemToSnapTo = index;
        this._scrollOffsetRef = this._positions[index] && this._positions[index].start;
        this._onScrollTriggered = false;

        if (!this._scrollOffsetRef && this._scrollOffsetRef !== 0) {
            return;
        }

        this._scrollTo(this._scrollOffsetRef, animated);

        if (enableMomentum) {
            // iOS fix, check the note in the constructor
            if (IS_IOS && !initial) {
                this._ignoreNextMomentum = true;
            }

            // When momentum is enabled and the user is overscrolling or swiping very quickly,
            // 'onScroll' is not going to be triggered for edge items. Then callback won't be
            // fired and loop won't work since the scrollview is not going to be repositioned.
            // As a workaround, '_onScroll()' will be called manually for these items if a given
            // condition hasn't been met after a small delay.
            // WARNING: this is ok only when relying on 'momentumScrollEnd', not with 'scrollEndDrag'
            if (index === 0 || index === itemsLength - 1) {
                clearTimeout(this._edgeItemTimeout);
                this._edgeItemTimeout = setTimeout(() => {
                    if (!initial && index === this._activeItem && !this._onScrollTriggered) {
                        this._onScroll();
                    }
                }, 250);
            }
        }
    }

    _onBeforeSnap (index) {
        const { onBeforeSnapToItem } = this.props;

        if (!this._carouselRef) {
            return;
        }

        this._canFireBeforeCallback = false;
        onBeforeSnapToItem && onBeforeSnapToItem(index);
    }

    _onSnap (index) {
        const { onSnapToItem } = this.props;

        if (!this._carouselRef) {
            return;
        }

        this._canFireCallback = false;
        onSnapToItem && onSnapToItem(index);
    }

    startAutoplay () {
        const { autoplayInterval, autoplayDelay } = this.props;

        if (this._autoplaying) {
            return;
        }

        clearTimeout(this._autoplayTimeout);
        this._autoplayTimeout = setTimeout(() => {
            this._autoplaying = true;
            this._autoplayInterval = setInterval(() => {
                if (this._autoplaying) {
                    this.snapToNext();
                }
            }, autoplayInterval);
        }, autoplayDelay);
    }

    stopAutoplay () {
        this._autoplaying = false;
        clearInterval(this._autoplayInterval);
    }

    snapToItem (index, animated = true, fireCallback = true) {
        if (!index || index < 0) {
            index = 0;
        }

        const positionIndex = this._getPositionIndex(index);

        if (positionIndex === this._activeItem) {
            return;
        }

        this._snapToItem(positionIndex, animated, fireCallback);
    }

    snapToNext (animated = true, fireCallback = true) {
        const itemsLength = this._getCustomDataLength();

        let newIndex = this._activeItem + 1;
        if (newIndex > itemsLength - 1) {
            if (!this._enableLoop()) {
                return;
            }
            newIndex = 0;
        }
        this._snapToItem(newIndex, animated, fireCallback);
    }

    snapToPrev (animated = true, fireCallback = true) {
        const itemsLength = this._getCustomDataLength();

        let newIndex = this._activeItem - 1;
        if (newIndex < 0) {
            if (!this._enableLoop()) {
                return;
            }
            newIndex = itemsLength - 1;
        }
        this._snapToItem(newIndex, animated, fireCallback);
    }

    // https://github.com/facebook/react-native/issues/1831#issuecomment-231069668
    triggerRenderingHack (offset) {
        // Avoid messing with user scroll
        if (Date.now() - this._lastScrollDate < 500) {
            return;
        }

        const scrollPosition = this._currentContentOffset;
        if (!scrollPosition && scrollPosition !== 0) {
            return;
        }

        const scrollOffset = offset || (scrollPosition === 0 ? 1 : -1);
        this._scrollTo(scrollPosition + scrollOffset, false);
    }

    _getSlideInterpolatedStyle (index, animatedValue) {
        const { layoutCardOffset, slideInterpolatedStyle } = this.props;

        if (slideInterpolatedStyle) {
            return slideInterpolatedStyle(index, animatedValue, this.props);
        } else if (this._shouldUseTinderLayout()) {
            return tinderAnimatedStyles(index, animatedValue, this.props, layoutCardOffset);
        } else if (this._shouldUseStackLayout()) {
            return stackAnimatedStyles(index, animatedValue, this.props, layoutCardOffset);
        } else if (this._shouldUseShiftLayout()) {
            return shiftAnimatedStyles(index, animatedValue, this.props);
        } else {
            return defaultAnimatedStyles(index, animatedValue, this.props);
        }
    }

    _renderItem ({ item, index }) {
        const { interpolators } = this.state;
        const {
            hasParallaxImages,
            itemWidth,
            itemHeight,
            keyExtractor,
            renderItem,
            sliderHeight,
            sliderWidth,
            slideStyle,
            vertical
        } = this.props;

        const animatedValue = interpolators && interpolators[index];

        if (!animatedValue && animatedValue !== 0) {
            return false;
        }

        const animate = this._shouldAnimateSlides();
        const Component = animate ? Animated.View : View;
        const animatedStyle = animate ? this._getSlideInterpolatedStyle(index, animatedValue) : {};

        const parallaxProps = hasParallaxImages ? {
            scrollPosition: this._scrollPos,
            carouselRef: this._carouselRef,
            vertical,
            sliderWidth,
            sliderHeight,
            itemWidth,
            itemHeight
        } : undefined;

        const mainDimension = vertical ? { height: itemHeight } : { width: itemWidth };
        const specificProps = this._needsScrollView() ? {
            key: keyExtractor ? keyExtractor(item, index) : this._getKeyExtractor(item, index)
        } : {};

        return (
            <Component style={[mainDimension, slideStyle, animatedStyle]} pointerEvents={'box-none'} {...specificProps}>
                { renderItem({ item, index }, parallaxProps) }
            </Component>
        );
    }

    _getComponentOverridableProps () {
        const {
            enableMomentum,
            itemWidth,
            itemHeight,
            loopClonesPerSide,
            sliderWidth,
            sliderHeight,
            vertical
        } = this.props;

        const visibleItems = Math.ceil(vertical ?
            sliderHeight / itemHeight :
            sliderWidth / itemWidth) + 1;
        const initialNumPerSide = this._enableLoop() ? loopClonesPerSide : 2;
        const initialNumToRender = visibleItems + (initialNumPerSide * 2);
        const maxToRenderPerBatch = 1 + (initialNumToRender * 2);
        const windowSize = maxToRenderPerBatch;

        const specificProps = !this._needsScrollView() ? {
            initialNumToRender: initialNumToRender,
            maxToRenderPerBatch: maxToRenderPerBatch,
            windowSize: windowSize
            // updateCellsBatchingPeriod
        } : {};

        return {
            decelerationRate: enableMomentum ? 0.9 : 'fast',
            showsHorizontalScrollIndicator: false,
            showsVerticalScrollIndicator: false,
            overScrollMode: 'never',
            automaticallyAdjustContentInsets: false,
            directionalLockEnabled: true,
            pinchGestureEnabled: false,
            scrollsToTop: false,
            removeClippedSubviews: true,
            inverted: this._needsRTLAdaptations(),
            // renderToHardwareTextureAndroid: true,
            ...specificProps
        };
    }

    _getComponentStaticProps () {
        const { hideCarousel } = this.state;
        const {
            containerCustomStyle,
            contentContainerCustomStyle,
            keyExtractor,
            sliderWidth,
            sliderHeight,
            style,
            vertical
        } = this.props;

        const containerStyle = [
            containerCustomStyle || style || {},
            hideCarousel ? { opacity: 0 } : {},
            vertical ?
                { height: sliderHeight, flexDirection: 'column' } :
                // LTR hack; see https://github.com/facebook/react-native/issues/11960
                // and https://github.com/facebook/react-native/issues/13100#issuecomment-328986423
                { width: sliderWidth, flexDirection: this._needsRTLAdaptations() ? 'row-reverse' : 'row' }
        ];
        const contentContainerStyle = [
            contentContainerCustomStyle || {},
            vertical ? {
                paddingTop: this._getContainerInnerMargin(),
                paddingBottom: this._getContainerInnerMargin(true)
            } : {
                paddingLeft: this._getContainerInnerMargin(),
                paddingRight: this._getContainerInnerMargin(true)
            }
        ];

        const specificProps = !this._needsScrollView() ? {
            // extraData: this.state,
            renderItem: this._renderItem,
            numColumns: 1,
            getItemLayout: undefined, // see #193
            initialScrollIndex: undefined, // see #193
            keyExtractor: keyExtractor || this._getKeyExtractor
        } : {};

        return {
            ref: c => this._carouselRef = c,
            data: this._getCustomData(),
            style: containerStyle,
            contentContainerStyle: contentContainerStyle,
            horizontal: !vertical,
            scrollEventThrottle: 1,
            onScroll: this._onScrollHandler,
            onScrollBeginDrag: this._onScrollBeginDrag,
            onScrollEndDrag: this._onScrollEndDrag,
            onMomentumScrollEnd: this._onMomentumScrollEnd,
            onResponderRelease: this._onTouchRelease,
            onStartShouldSetResponderCapture: this._onStartShouldSetResponderCapture,
            onTouchStart: this._onTouchStart,
            onLayout: this._onLayout,
            ...specificProps
        };
    }

    render () {
        const { data, renderItem } = this.props;

        if (!data || !renderItem) {
            return false;
        }

        const props = {
            ...this._getComponentOverridableProps(),
            ...this.props,
            ...this._getComponentStaticProps()
        };

        return this._needsScrollView() ? (
            <AnimatedScrollView {...props}>
                {
                    this._getCustomData().map((item, index) => {
                        return this._renderItem({ item, index });
                    })
                }
            </AnimatedScrollView>
        ) : (
            <AnimatedFlatList {...props} />
        );
    }
}


// Get scroll interpolator's input range from an array of slide indexes
// Indexes are relative to the current active slide (index 0)
// For example, using [3, 2, 1, 0, -1] will return:
// [
//     (index - 3) * sizeRef, // active + 3
//     (index - 2) * sizeRef, // active + 2
//     (index - 1) * sizeRef, // active + 1
//     index * sizeRef, // active
//     (index + 1) * sizeRef // active - 1
// ]
export function getInputRangeFromIndexes (range, index, carouselProps) {
    const sizeRef = carouselProps.vertical ? carouselProps.itemHeight : carouselProps.itemWidth;
    let inputRange = [];

    for (let i = 0; i < range.length; i++) {
        inputRange.push((index - range[i]) * sizeRef);
    }

    return inputRange;
}

// Default behavior
// Scale and/or opacity effect
// Based on props 'inactiveSlideOpacity' and 'inactiveSlideScale'
export function defaultScrollInterpolator (index, carouselProps) {
    const range = [1, 0, -1];
    const inputRange = getInputRangeFromIndexes(range, index, carouselProps);
    const outputRange = [0, 1, 0];

    return { inputRange, outputRange };
}


export function defaultAnimatedStyles (index, animatedValue, carouselProps) {
    let animatedOpacity = {};
    let animatedScale = {};

    if (carouselProps.inactiveSlideOpacity < 1) {
        animatedOpacity = {
            opacity: animatedValue.interpolate({
                inputRange: [0, 1],
                outputRange: [carouselProps.inactiveSlideOpacity, 1]
            })
        };
    }

    if (carouselProps.inactiveSlideScale < 1) {
        animatedScale = {
            transform: [{
                scale: animatedValue.interpolate({
                    inputRange: [0, 1],
                    outputRange: [carouselProps.inactiveSlideScale, 1]
                })
            }]
        };
    }

    return {
        ...animatedOpacity,
        ...animatedScale
    };
}

// Shift animation
// Same as the default one, but the active slide is also shifted up or down
// Based on prop 'inactiveSlideShift'
export function shiftAnimatedStyles (index, animatedValue, carouselProps) {
    let animatedOpacity = {};
    let animatedScale = {};
    let animatedTranslate = {};

    if (carouselProps.inactiveSlideOpacity < 1) {
        animatedOpacity = {
            opacity: animatedValue.interpolate({
                inputRange: [0, 1],
                outputRange: [carouselProps.inactiveSlideOpacity, 1]
            })
        };
    }

    if (carouselProps.inactiveSlideScale < 1) {
        animatedScale = {
            scale: animatedValue.interpolate({
                inputRange: [0, 1],
                outputRange: [carouselProps.inactiveSlideScale, 1]
            })
        };
    }

    if (carouselProps.inactiveSlideShift !== 0) {
        const translateProp = carouselProps.vertical ? 'translateX' : 'translateY';
        animatedTranslate = {
            [translateProp]: animatedValue.interpolate({
                inputRange: [0, 1],
                outputRange: [carouselProps.inactiveSlideShift, 0]
            })
        };
    }

    return {
        ...animatedOpacity,
        transform: [
            { ...animatedScale },
            { ...animatedTranslate }
        ]
    };
}

// Stack animation
// Imitate a deck/stack of cards (see #195)
// WARNING: The effect had to be visually inverted on Android because this OS doesn't honor the `zIndex`property
// This means that the item with the higher zIndex (and therefore the tap receiver) remains the one AFTER the currently active item
// The `elevation` property compensates for that only visually, which is not good enough
export function stackScrollInterpolator (index, carouselProps) {
    const range = IS_ANDROID ?
        [1, 0, -1, -2, -3] :
        [3, 2, 1, 0, -1];
    const inputRange = getInputRangeFromIndexes(range, index, carouselProps);
    const outputRange = range;

    return { inputRange, outputRange };
}


export function stackAnimatedStyles (index, animatedValue, carouselProps, cardOffset) {
    const sizeRef = carouselProps.vertical ? carouselProps.itemHeight : carouselProps.itemWidth;
    const translateProp = carouselProps.vertical ? 'translateY' : 'translateX';

    const card1Scale = 0.9;
    const card2Scale = 0.8;

    cardOffset = !cardOffset && cardOffset !== 0 ? 18 : cardOffset;

    const getTranslateFromScale = (cardIndex, scale) => {
        const centerFactor = 1 / scale * cardIndex;
        const centeredPosition = -Math.round(sizeRef * centerFactor);
        const edgeAlignment = Math.round((sizeRef - (sizeRef * scale)) / 2);
        const offset = Math.round(cardOffset * Math.abs(cardIndex) / scale);

        return IS_ANDROID ?
            centeredPosition - edgeAlignment - offset :
            centeredPosition + edgeAlignment + offset;
    };

    return IS_ANDROID ? {
        // elevation: carouselProps.data.length - index, // fix zIndex bug visually, but not from a logic point of view
        opacity: animatedValue.interpolate({
            inputRange: [-3, -2, -1, 0],
            outputRange: [0, 0.5, 0.75, 1],
            extrapolate: 'clamp'
        }),
        transform: [{
            scale: animatedValue.interpolate({
                inputRange: [-2, -1, 0, 1],
                outputRange: [card2Scale, card1Scale, 1, card1Scale],
                extrapolate: 'clamp'
            })
        }, {
            [translateProp]: animatedValue.interpolate({
                inputRange: [-3, -2, -1, 0, 1],
                outputRange: [
                    getTranslateFromScale(-3, card2Scale),
                    getTranslateFromScale(-2, card2Scale),
                    getTranslateFromScale(-1, card1Scale),
                    0,
                    sizeRef * 0.5
                ],
                extrapolate: 'clamp'
            })
        }]
    } : {
        zIndex: carouselProps.data.length - index,
        opacity: animatedValue.interpolate({
            inputRange: [0, 1, 2, 3],
            outputRange: [1, 0.75, 0.5, 0],
            extrapolate: 'clamp'
        }),
        transform: [{
            scale: animatedValue.interpolate({
                inputRange: [-1, 0, 1, 2],
                outputRange: [card1Scale, 1, card1Scale, card2Scale],
                extrapolate: 'clamp'
            })
        }, {
            [translateProp]: animatedValue.interpolate({
                inputRange: [-1, 0, 1, 2, 3],
                outputRange: [
                    -sizeRef * 0.5,
                    0,
                    getTranslateFromScale(1, card1Scale),
                    getTranslateFromScale(2, card2Scale),
                    getTranslateFromScale(3, card2Scale)
                ],
                extrapolate: 'clamp'
            })
        }]
    };
}

// Tinder animation
// Imitate the popular Tinder layout
// WARNING: The effect had to be visually inverted on Android because this OS doesn't honor the `zIndex`property
// This means that the item with the higher zIndex (and therefore the tap receiver) remains the one AFTER the currently active item
// The `elevation` property compensates for that only visually, which is not good enough
export function tinderScrollInterpolator (index, carouselProps) {
    const range = IS_ANDROID ?
        [1, 0, -1, -2, -3] :
        [3, 2, 1, 0, -1];
    const inputRange = getInputRangeFromIndexes(range, index, carouselProps);
    const outputRange = range;

    return { inputRange, outputRange };
}



export function tinderAnimatedStyles (index, animatedValue, carouselProps, cardOffset) {
    const sizeRef = carouselProps.vertical ? carouselProps.itemHeight : carouselProps.itemWidth;
    const mainTranslateProp = carouselProps.vertical ? 'translateY' : 'translateX';
    const secondaryTranslateProp = carouselProps.vertical ? 'translateX' : 'translateY';

    const card1Scale = 0.96;
    const card2Scale = 0.92;
    const card3Scale = 0.88;

    const peekingCardsOpacity = IS_ANDROID ? 0.92 : 1;

    cardOffset = !cardOffset && cardOffset !== 0 ? 9 : cardOffset;

    const getMainTranslateFromScale = (cardIndex, scale) => {
        const centerFactor = 1 / scale * cardIndex;
        return -Math.round(sizeRef * centerFactor);
    };

    const getSecondaryTranslateFromScale = (cardIndex, scale) => {
        return Math.round(cardOffset * Math.abs(cardIndex) / scale);
    };

    return IS_ANDROID ? {
        // elevation: carouselProps.data.length - index, // fix zIndex bug visually, but not from a logic point of view
        opacity: animatedValue.interpolate({
            inputRange: [-3, -2, -1, 0, 1],
            outputRange: [0, peekingCardsOpacity, peekingCardsOpacity, 1, 0],
            extrapolate: 'clamp'
        }),
        transform: [{
            scale: animatedValue.interpolate({
                inputRange: [-3, -2, -1, 0],
                outputRange: [card3Scale, card2Scale, card1Scale, 1],
                extrapolate: 'clamp'
            })
        }, {
            rotate: animatedValue.interpolate({
                inputRange: [0, 1],
                outputRange: ['0deg', '22deg'],
                extrapolate: 'clamp'
            })
        }, {
            [mainTranslateProp]: animatedValue.interpolate({
                inputRange: [-3, -2, -1, 0, 1],
                outputRange: [
                    getMainTranslateFromScale(-3, card3Scale),
                    getMainTranslateFromScale(-2, card2Scale),
                    getMainTranslateFromScale(-1, card1Scale),
                    0,
                    sizeRef * 1.1
                ],
                extrapolate: 'clamp'
            })
        }, {
            [secondaryTranslateProp]: animatedValue.interpolate({
                inputRange: [-3, -2, -1, 0],
                outputRange: [
                    getSecondaryTranslateFromScale(-3, card3Scale),
                    getSecondaryTranslateFromScale(-2, card2Scale),
                    getSecondaryTranslateFromScale(-1, card1Scale),
                    0
                ],
                extrapolate: 'clamp'
            })
        }]
    } : {
        zIndex: carouselProps.data.length - index,
        opacity: animatedValue.interpolate({
            inputRange: [-1, 0, 1, 2, 3],
            outputRange: [0, 1, peekingCardsOpacity, peekingCardsOpacity, 0],
            extrapolate: 'clamp'
        }),
        transform: [{
            scale: animatedValue.interpolate({
                inputRange: [0, 1, 2, 3],
                outputRange: [1, card1Scale, card2Scale, card3Scale],
                extrapolate: 'clamp'
            })
        }, {
            rotate: animatedValue.interpolate({
                inputRange: [-1, 0],
                outputRange: ['-22deg', '0deg'],
                extrapolate: 'clamp'
            })
        }, {
            [mainTranslateProp]: animatedValue.interpolate({
                inputRange: [-1, 0, 1, 2, 3],
                outputRange: [
                    -sizeRef * 1.1,
                    0,
                    getMainTranslateFromScale(1, card1Scale),
                    getMainTranslateFromScale(2, card2Scale),
                    getMainTranslateFromScale(3, card3Scale)
                ],
                extrapolate: 'clamp'
            })
        }, {
            [secondaryTranslateProp]: animatedValue.interpolate({
                inputRange: [0, 1, 2, 3],
                outputRange: [
                    0,
                    getSecondaryTranslateFromScale(1, card1Scale),
                    getSecondaryTranslateFromScale(2, card2Scale),
                    getSecondaryTranslateFromScale(3, card3Scale)
                ],
                extrapolate: 'clamp'
            })
        }]
    };
}


export function scrollInterpolator1 (index, carouselProps) {
    const range = [3, 2, 1, 0, -1];
    const inputRange = getInputRangeFromIndexes(range, index, carouselProps);
    const outputRange = range;

    return { inputRange, outputRange };
}

export function animatedStyles1 (index, animatedValue, carouselProps) {
    const sizeRef = carouselProps.vertical ? carouselProps.itemHeight : carouselProps.itemWidth;
    const translateProp = carouselProps.vertical ? 'translateY' : 'translateX';

    return {
        zIndex: carouselProps.data.length - index,
        opacity: animatedValue.interpolate({
            inputRange: [2, 3],
            outputRange: [1, 0],
            extrapolate: 'clamp'
        }),
        transform: [{
            rotate: animatedValue.interpolate({
                inputRange: [-1, 0, 1, 2, 3],
                outputRange: ['-25deg', '0deg', '-3deg', '1.8deg', '0deg'],
                extrapolate: 'clamp'
            })
        }, {
            [translateProp]: animatedValue.interpolate({
                inputRange: [-1, 0, 1, 2, 3],
                outputRange: [
                    -sizeRef * 0.5,
                    0,
                    -sizeRef, // centered
                    -sizeRef * 2, // centered
                    -sizeRef * 3 // centered
                ],
                extrapolate: 'clamp'
            })
        }]
    };
}

// Perspective effect
export function scrollInterpolator2 (index, carouselProps) {
    const range = [2, 1, 0, -1];
    const inputRange = getInputRangeFromIndexes(range, index, carouselProps);
    const outputRange = range;

    return { inputRange, outputRange };
}

export function animatedStyles2 (index, animatedValue, carouselProps) {
    const sizeRef = carouselProps.vertical ? carouselProps.itemHeight : carouselProps.itemWidth;
    const translateProp = carouselProps.vertical ? 'translateY' : 'translateX';

    return {
        zIndex: carouselProps.data.length - index,
        opacity: animatedValue.interpolate({
            inputRange: [-1, 0, 1, 2],
            outputRange: [0.75, 1, 0.6, 0.4]
        }),
        transform: [{
            rotate: animatedValue.interpolate({
                inputRange: [-1, 0, 1, 2],
                outputRange: ['0deg', '0deg', '5deg', '8deg'],
                extrapolate: 'clamp'
            })
        }, {
            scale: animatedValue.interpolate({
                inputRange: [-1, 0, 1, 2],
                outputRange: [0.96, 1, 0.85, 0.7]
            })
        }, {
            [translateProp]: animatedValue.interpolate({
                inputRange: [-1, 0, 1, 2],
                outputRange: [
                    0,
                    0,
                    -sizeRef + 30,
                    -sizeRef * 2 + 45
                ],
                extrapolate: 'clamp'
            })
        }]
    };
}

// Left/right translate effect
export function scrollInterpolator3 (index, carouselProps) {
    const range = [2, 1, 0, -1];
    const inputRange = getInputRangeFromIndexes(range, index, carouselProps);
    const outputRange = range;

    return { inputRange, outputRange };
}

export function animatedStyles3 (index, animatedValue, carouselProps) {
    const sizeRef = carouselProps.vertical ? carouselProps.itemHeight : carouselProps.itemWidth;
    const translateProp = carouselProps.vertical ? 'translateY' : 'translateX';

    return {
        zIndex: carouselProps.data.length - index,
        opacity: animatedValue.interpolate({
            inputRange: [-1, 0, 1, 2],
            outputRange: [1, 1, 0.75, 0.5],
            extrapolate: 'clamp'
        }),
        transform: [{
            [translateProp]: animatedValue.interpolate({
                inputRange: [-1, 0, 1, 2],
                outputRange: [
                    0,
                    0,
                    -sizeRef * 2,
                    -sizeRef
                ],
                extrapolate: 'clamp'
            })
        }]
    };
}

// From https://codeburst.io/horizontal-scroll-animations-in-react-native-18dac6e9c720
export function scrollInterpolator4 (index, carouselProps) {
    const range = [1, 0, -1];
    const inputRange = getInputRangeFromIndexes(range, index, carouselProps);
    const outputRange = range;

    return { inputRange, outputRange };
}

export function animatedStyles4 (index, animatedValue, carouselProps) {
    return {
        zIndex: carouselProps.data.length - index,
        opacity: animatedValue.interpolate({
            inputRange: [-1, 0, 1],
            outputRange: [0.75, 1, 0.75],
            extrapolate: 'clamp'
        }),
        transform: [
            {
                perspective: 1000
            },
            {
                scale: animatedValue.interpolate({
                    inputRange: [-1, 0, 1],
                    outputRange: [0.65, 1, 0.65],
                    extrapolate: 'clamp'
                })
            },
            {
                rotateX: animatedValue.interpolate({
                    inputRange: [-1, 0, 1],
                    outputRange: ['30deg', '0deg', '30deg'],
                    extrapolate: 'clamp'
                })
            },
            {
                rotateY: animatedValue.interpolate({
                    inputRange: [-1, 0, 1],
                    outputRange: ['-30deg', '0deg', '30deg'],
                    extrapolate: 'clamp'
                })
            }
        ]
    };
}


export const scrollInterpolators = {
    scrollInterpolator1,
    scrollInterpolator2,
    scrollInterpolator3,
    scrollInterpolator4
};

export const animatedStyles = {
    animatedStyles1,
    animatedStyles2,
    animatedStyles3,
    animatedStyles4
};





class Pagination extends PureComponent {

    static propTypes = {
        activeDotIndex: PropTypes.number.isRequired,
        dotsLength: PropTypes.number.isRequired,
        activeOpacity: PropTypes.number,
        carouselRef: PropTypes.object,
        containerStyle: ViewPropTypes ? ViewPropTypes.style : View.propTypes.style,
        dotColor: PropTypes.string,
        dotContainerStyle: ViewPropTypes ? ViewPropTypes.style : View.propTypes.style,
        dotElement: PropTypes.element,
        dotStyle: ViewPropTypes ? ViewPropTypes.style : View.propTypes.style,
        inactiveDotColor: PropTypes.string,
        inactiveDotElement: PropTypes.element,
        inactiveDotOpacity: PropTypes.number,
        inactiveDotScale: PropTypes.number,
        inactiveDotStyle: ViewPropTypes ? ViewPropTypes.style : View.propTypes.style,
        renderDots: PropTypes.func,
        tappableDots: PropTypes.bool,
        vertical: PropTypes.bool
    };

    static defaultProps = {
        inactiveDotOpacity: 0.5,
        inactiveDotScale: 0.5,
        tappableDots: false,
        vertical: false
    }

    constructor (props) {
        super(props);

        // Warnings
        if ((props.dotColor && !props.inactiveDotColor) || (!props.dotColor && props.inactiveDotColor)) {
            console.warn(
                'react-native-snap-carousel | Pagination: ' +
                'You need to specify both `dotColor` and `inactiveDotColor`'
            );
        }
        if ((props.dotElement && !props.inactiveDotElement) || (!props.dotElement && props.inactiveDotElement)) {
            console.warn(
                'react-native-snap-carousel | Pagination: ' +
                'You need to specify both `dotElement` and `inactiveDotElement`'
            );
        }
        if (props.tappableDots && !props.carouselRef) {
            console.warn(
                'react-native-snap-carousel | Pagination: ' +
                'You must specify prop `carouselRef` when setting `tappableDots` to `true`'
            );
        }
    }

    _needsRTLAdaptations () {
        const { vertical } = this.props;
        return IS_RTL && !IS_IOS && !vertical;
    }

    get _activeDotIndex () {
        const { activeDotIndex, dotsLength } = this.props;
        return this._needsRTLAdaptations() ? dotsLength - activeDotIndex - 1 : activeDotIndex;
    }

    get dots () {
        const {
            activeOpacity,
            carouselRef,
            dotsLength,
            dotColor,
            dotContainerStyle,
            dotElement,
            dotStyle,
            inactiveDotColor,
            inactiveDotElement,
            inactiveDotOpacity,
            inactiveDotScale,
            inactiveDotStyle,
            renderDots,
            tappableDots
        } = this.props;

        if (renderDots) {
            return renderDots(this._activeDotIndex, dotsLength, this);
        }

        const DefaultDot = <PaginationDot
          carouselRef={carouselRef}
          tappable={tappableDots && typeof carouselRef !== 'undefined'}
          activeOpacity={activeOpacity}
          color={dotColor}
          containerStyle={dotContainerStyle}
          style={dotStyle}
          inactiveColor={inactiveDotColor}
          inactiveOpacity={inactiveDotOpacity}
          inactiveScale={inactiveDotScale}
          inactiveStyle={inactiveDotStyle}
        />;

        let dots = [];

        for (let i = 0; i < dotsLength; i++) {
            const isActive = i === this._activeDotIndex;
            dots.push(React.cloneElement(
                (isActive ? dotElement : inactiveDotElement) || DefaultDot,
                {
                    key: `pagination-dot-${i}`,
                    active: i === this._activeDotIndex,
                    index: i
                }
            ));
        }

        return dots;
    }

    render () {
        const { dotsLength, containerStyle, vertical } = this.props;

        if (!dotsLength || dotsLength < 2) {
            return false;
        }

        const style = [
            stylesPagination.sliderPagination,
            { flexDirection: vertical ?
                'column' :
                (this._needsRTLAdaptations() ? 'row-reverse' : 'row')
            },
            containerStyle || {}
        ];

        return (
            <View pointerEvents={'box-none'} style={style}>
                { this.dots }
            </View>
        );
    }
}


class PaginationDot extends PureComponent {

    static propTypes = {
        inactiveOpacity: PropTypes.number.isRequired,
        inactiveScale: PropTypes.number.isRequired,
        active: PropTypes.bool,
        activeOpacity: PropTypes.number,
        carouselRef: PropTypes.object,
        color: PropTypes.string,
        containerStyle: ViewPropTypes ? ViewPropTypes.style : View.propTypes.style,
        inactiveColor: PropTypes.string,
        inactiveStyle: ViewPropTypes ? ViewPropTypes.style : View.propTypes.style,
        index: PropTypes.number,
        style: ViewPropTypes ? ViewPropTypes.style : View.propTypes.style,
        tappable: PropTypes.bool
    };

    constructor (props) {
        super(props);
        this.state = {
            animColor: new Animated.Value(0),
            animOpacity: new Animated.Value(0),
            animTransform: new Animated.Value(0)
        };
    }

    componentDidMount () {
        if (this.props.active) {
            this._animate(1);
        }
    }

    UNSAFE_componentWillReceiveProps (nextProps) {
        if (nextProps.active !== this.props.active) {
            this._animate(nextProps.active ? 1 : 0);
        }
    }

    _animate (toValue = 0) {
        const { animColor, animOpacity, animTransform } = this.state;

        const commonProperties = {
            toValue,
            duration: 250,
            isInteraction: false,
            useNativeDriver: !this._shouldAnimateColor
        };

        let animations = [
            Animated.timing(animOpacity, {
                easing: Easing.linear,
                ...commonProperties
            }),
            Animated.spring(animTransform, {
                friction: 4,
                tension: 50,
                ...commonProperties
            })
        ];

        if (this._shouldAnimateColor) {
            animations.push(Animated.timing(animColor, {
                easing: Easing.linear,
                ...commonProperties
            }));
        }

        Animated.parallel(animations).start();
    }

    get _shouldAnimateColor () {
        const { color, inactiveColor } = this.props;
        return color && inactiveColor;
    }

    render () {
        const { animColor, animOpacity, animTransform } = this.state;
        const {
            active,
            activeOpacity,
            carouselRef,
            color,
            containerStyle,
            inactiveColor,
            inactiveStyle,
            inactiveOpacity,
            inactiveScale,
            index,
            style,
            tappable
        } = this.props;

        const animatedStyle = {
            opacity: animOpacity.interpolate({
                inputRange: [0, 1],
                outputRange: [inactiveOpacity, 1]
            }),
            transform: [{
                scale: animTransform.interpolate({
                    inputRange: [0, 1],
                    outputRange: [inactiveScale, 1]
                })
            }]
        };
        const animatedColor = this._shouldAnimateColor ? {
            backgroundColor: animColor.interpolate({
                inputRange: [0, 1],
                outputRange: [inactiveColor, color]
            })
        } : {};

        const dotContainerStyle = [
            styles.sliderPaginationDotContainer,
            containerStyle || {}
        ];

        const dotStyle = [
            styles.sliderPaginationDot,
            style || {},
            (!active && inactiveStyle) || {},
            animatedStyle,
            animatedColor
        ];

        const onPress = tappable ? () => {
            carouselRef && carouselRef._snapToItem(carouselRef._getPositionIndex(index));
        } : undefined;

        return (
            <TouchableOpacity
              style={dotContainerStyle}
              activeOpacity={tappable ? activeOpacity : 1}
              onPress={onPress}
            >
                <Animated.View useNativeDriver={true}   style={dotStyle} />
            </TouchableOpacity>
        );
    }
}


AnterosAdvancedCarousel.Pagination = Pagination;
AnterosAdvancedCarousel.PaginationDot = PaginationDot;



const DEFAULT_DOT_SIZE = 7;
const DEFAULT_DOT_COLOR = 'rgba(0, 0, 0, 0.75)';

const stylesPagination= StyleSheet.create({
    sliderPagination: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 20,
        paddingVertical: 30
    },
    sliderPaginationDotContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        marginHorizontal: 8
    },
    sliderPaginationDot: {
        width: DEFAULT_DOT_SIZE,
        height: DEFAULT_DOT_SIZE,
        borderRadius: DEFAULT_DOT_SIZE / 2,
        backgroundColor: DEFAULT_DOT_COLOR
    }
});