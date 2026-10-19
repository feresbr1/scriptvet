import { render } from 'preact';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/fira-code/400.css';
import './styles.css';
import { App } from './App';

render(<App />, document.getElementById('app')!);
