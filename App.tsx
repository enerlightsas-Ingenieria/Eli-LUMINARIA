import React, { Component, ErrorInfo, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, Text, View, useColorScheme } from 'react-native';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { AppProvider, useApp } from './src/context/AppContext';
import { AjustesScreen } from './src/screens/AjustesScreen';
import { CapturarScreen } from './src/screens/CapturarScreen';
import { EditarScreen } from './src/screens/EditarScreen';
import { MapaScreen } from './src/screens/MapaScreen';
import { ProyectosScreen } from './src/screens/ProyectosScreen';
import { RegistrosScreen } from './src/screens/RegistrosScreen';
import { ESQUEMA } from './src/lib/config';
import { pedirYAplicar } from './src/services/configuracion';
import { cargarAjustes, guardarAjustes, PreferenciaTema } from './src/services/settings';
import { sincronizarTodo } from './src/services/sync';
import { paletas, TemaContext, useTema } from './src/theme';
import type { RootStackParams } from './src/navigation';

const Stack = createNativeStackNavigator<RootStackParams>();
const Tab = createBottomTabNavigator();

class LimiteDeErrores extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, backgroundColor: '#0F1B2D' }}>
        <Text style={{ color: '#FFC53D', fontSize: 20, fontWeight: '800', marginBottom: 8 }}>Algo salió mal</Text>
        <Text style={{ color: '#F2F6FB', textAlign: 'center', marginBottom: 20 }}>Tus datos están a salvo en el teléfono. {this.state.error.message}</Text>
        <Pressable onPress={() => this.setState({ error: null })} style={{ backgroundColor: '#FFC53D', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 }}>
          <Text style={{ fontWeight: '800' }}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }
}

function Tabs() {
  const { c } = useTema();
  const { bottom } = useSafeAreaInsets();
  const icono = (n: string): keyof typeof Ionicons.glyphMap => (
    n === 'Registros' ? 'list' : n === 'Mapa' ? 'map' : n === 'Proyectos' ? 'folder-open' : 'settings'
  );
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, height: 56 + bottom, paddingBottom: bottom },
        tabBarIcon: ({ color, size }) => <Ionicons name={icono(route.name)} size={size} color={color} />,
      })}
    >
      <Tab.Screen name="Registros">
        {({ navigation }) => <RegistrosScreen irAProyectos={() => navigation.navigate('Proyectos' as never)} />}
      </Tab.Screen>
      <Tab.Screen name="Mapa" component={MapaScreen} />
      <Tab.Screen name="Proyectos" component={ProyectosScreen} />
      <Tab.Screen name="Ajustes" component={AjustesScreen} />
    </Tab.Navigator>
  );
}

/** Abre enlaces eliluminaria://config?c=… (flotas) y pide confirmación antes de aplicarlos. */
function EnlacesDeConfiguracion() {
  const { activar, proyecto, refrescar } = useApp();
  useEffect(() => {
    const manejar = (url?: string | null) => {
      if (url?.startsWith(ESQUEMA)) pedirYAplicar(url, async () => { if (proyecto) await activar(proyecto.id); else await refrescar(); });
    };
    Linking.getInitialURL().then(manejar).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => manejar(e.url));
    return () => sub.remove();
  }, [activar, proyecto, refrescar]);
  return null;
}

/** Envía en segundo plano lo pendiente: al guardar, al volver a la app y cuando cambia el número de pendientes. */
function AutoSync() {
  const { items, listo, refrescar } = useApp();
  const pendientes = items.filter((l) => !l.sincronizado).length;
  const correr = useCallback(async () => {
    try { if ((await sincronizarTodo()) > 0) await refrescar(); } catch { /* sin conexión: se reintenta luego */ }
  }, [refrescar]);

  useEffect(() => {
    if (!listo || !pendientes) return;
    const t = setTimeout(correr, 3000);
    return () => clearTimeout(t);
  }, [listo, pendientes, correr]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (e) => { if (e === 'active') correr(); });
    return () => sub.remove();
  }, [correr]);
  return null;
}

function Raiz() {
  const { c, oscuro } = useTema();
  const { listo } = useApp();
  const base = oscuro ? DarkTheme : DefaultTheme;
  const tema = useMemo(() => ({
    ...base, colors: { ...base.colors, background: c.bg, card: c.surface, text: c.text, border: c.border, primary: c.primary },
  }), [base, c]);

  if (!listo) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}><ActivityIndicator size="large" color={c.primary} /></View>;
  }
  return (
    <NavigationContainer theme={tema}>
      <StatusBar style={oscuro ? 'light' : 'dark'} />
      <EnlacesDeConfiguracion />
      <AutoSync />
      <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: c.surface }, headerTintColor: c.text, headerBackTitle: 'Atrás', contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="Capturar" component={CapturarScreen} options={{ title: 'Nueva luminaria' }} />
        <Stack.Screen name="Editar" component={EditarScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  const sistema = useColorScheme();
  const [pref, setPrefState] = useState<PreferenciaTema>('auto');
  useEffect(() => { cargarAjustes().then((a) => setPrefState(a.tema)); }, []);

  const setPref = useCallback((p: PreferenciaTema) => {
    setPrefState(p);
    cargarAjustes().then((a) => guardarAjustes({ ...a, tema: p })).catch(() => {});
  }, []);

  const oscuro = pref === 'auto' ? sistema !== 'light' : pref === 'oscuro';
  const valor = useMemo(() => ({ c: oscuro ? paletas.oscuro : paletas.claro, oscuro, pref, setPref }), [oscuro, pref, setPref]);

  return (
    <LimiteDeErrores>
      <SafeAreaProvider>
        <TemaContext.Provider value={valor}>
          <AppProvider>
            <Raiz />
          </AppProvider>
        </TemaContext.Provider>
      </SafeAreaProvider>
    </LimiteDeErrores>
  );
}
