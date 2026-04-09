import React, { useState } from 'react';
import './escalationpage.css';

interface EscalationRule {
    id: string;
    name: string;
    monitor: string;
    failureThreshold: number;
    delay: number;
    type: 'email' | 'slack' | 'webhook';
    target: string;
    enabled: boolean;
}

const mockRules: EscalationRule[] = [
    {
        id: '1',
        name: 'Critical Alert',
        monitor: 'API Server',
        failureThreshold: 3,
        delay: 5,
        type: 'email',
        target: 'admin@example.com',
        enabled: true,
    },
    {
        id: '2',
        name: 'Database Down',
        monitor: 'Database',
        failureThreshold: 1,
        delay: 0,
        type: 'slack',
        target: '#alerts',
        enabled: true,
    },
];

export const EscalationPage: React.FC = () => {
    const [rules, setRules] = useState<EscalationRule[]>(mockRules);
    const [formData, setFormData] = useState<Omit<EscalationRule, 'id'>>({
        name: '',
        monitor: '',
        failureThreshold: 1,
        delay: 0,
        type: 'email',
        target: '',
        enabled: true,
    });

    const handleInputChange = (
        e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
    ) => {
        const { name, value, type } = e.target;
        setFormData((prev) => ({
            ...prev,
            [name]:
                type === 'checkbox'
                    ? (e.target as HTMLInputElement).checked
                    : name === 'failureThreshold' || name === 'delay'
                    ? parseInt(value)
                    : value,
        }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const newRule: EscalationRule = {
            ...formData,
            id: Date.now().toString(),
        };
        setRules([...rules, newRule]);
        setFormData({
            name: '',
            monitor: '',
            failureThreshold: 1,
            delay: 0,
            type: 'email',
            target: '',
            enabled: true,
        });
    };

    const toggleRule = (id: string) => {
        setRules(
            rules.map((rule) =>
                rule.id === id ? { ...rule, enabled: !rule.enabled } : rule
            )
        );
    };

    return (
        <div className="escalation-page">
            <h1>Escalations</h1>
            <p className="description">
                Manage escalation rules to notify teams when monitors fail.
            </p>

            <section className="rules-section">
                <h2>Active Rules</h2>
                <div className="rules-list">
                    {rules.map((rule) => (
                        <div key={rule.id} className="rule-card">
                            <div className="rule-header">
                                <h3>{rule.name}</h3>
                                <input
                                    type="checkbox"
                                    checked={rule.enabled}
                                    onChange={() => toggleRule(rule.id)}
                                />
                            </div>
                            <p>
                                <strong>Monitor:</strong> {rule.monitor}
                            </p>
                            <p>
                                <strong>Threshold:</strong> {rule.failureThreshold} failures
                            </p>
                            <p>
                                <strong>Delay:</strong> {rule.delay}s
                            </p>
                            <p>
                                <strong>Type:</strong> {rule.type}
                            </p>
                            <p>
                                <strong>Target:</strong> {rule.target}
                            </p>
                        </div>
                    ))}
                </div>
            </section>

            <section className="form-section">
                <h2>Add New Rule</h2>
                <form onSubmit={handleSubmit}>
                    <input
                        type="text"
                        name="name"
                        placeholder="Rule name"
                        value={formData.name}
                        onChange={handleInputChange}
                        required
                    />
                    <input
                        type="text"
                        name="monitor"
                        placeholder="Monitor name"
                        value={formData.monitor}
                        onChange={handleInputChange}
                        required
                    />
                    <input
                        type="number"
                        name="failureThreshold"
                        placeholder="Failure threshold"
                        value={formData.failureThreshold}
                        onChange={handleInputChange}
                        min="1"
                        required
                    />
                    <input
                        type="number"
                        name="delay"
                        placeholder="Delay (seconds)"
                        value={formData.delay}
                        onChange={handleInputChange}
                        min="0"
                        required
                    />
                    <select
                        name="type"
                        value={formData.type}
                        onChange={handleInputChange}
                    >
                        <option value="email">Email</option>
                        <option value="slack">Slack</option>
                        <option value="webhook">Webhook</option>
                    </select>
                    <input
                        type="text"
                        name="target"
                        placeholder="Target (email, channel, or URL)"
                        value={formData.target}
                        onChange={handleInputChange}
                        required
                    />
                    <label>
                        <input
                            type="checkbox"
                            name="enabled"
                            checked={formData.enabled}
                            onChange={handleInputChange}
                        />
                        Enabled
                    </label>
                    <button type="submit">Add Rule</button>
                </form>
            </section>
        </div>
    );
};

export default EscalationPage;