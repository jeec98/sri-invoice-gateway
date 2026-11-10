import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import './custom.css';
import Modulo11Calculator from '../../components/Modulo11Calculator.vue';
import WebhookVerifier from '../../components/WebhookVerifier.vue';
import SaasRegistrationForm from '../../components/SaasRegistrationForm.vue';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Modulo11Calculator', Modulo11Calculator);
    app.component('WebhookVerifier', WebhookVerifier);
    app.component('SaasRegistrationForm', SaasRegistrationForm);
  },
} satisfies Theme;
