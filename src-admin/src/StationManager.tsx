import React from 'react';
import {
    Alert,
    Box,
    Button,
    Checkbox,
    CircularProgress,
    IconButton,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from '@iobroker/json-config';

interface StationRow {
    active: boolean;
    name: string;
    evaNo: string;
    count: number;
    timeOffsetMinutes: number;
    categories: string;
}

interface SearchResult {
    value: string;
    label: string;
}

interface StationManagerState extends ConfigGenericState {
    searchQuery: string;
    searching: boolean;
    searchError: string;
    searchResults: SearchResult[];
}

function emptyStation(): StationRow {
    return { active: true, name: '', evaNo: '', count: 5, timeOffsetMinutes: 0, categories: '' };
}

export default class StationManager extends ConfigGeneric<ConfigGenericProps, StationManagerState> {
    constructor(props: ConfigGenericProps) {
        super(props);
        this.state = {
            ...this.state,
            searchQuery: '',
            searching: false,
            searchError: '',
            searchResults: [],
        };
    }

    private getInstanceId(): string {
        return `${this.props.oContext.adapterName}.${this.props.oContext.instance}`;
    }

    private getStations(): StationRow[] {
        const value: unknown = ConfigGeneric.getValue(this.props.data, this.props.attr!);
        return Array.isArray(value) ? (value as StationRow[]) : [];
    }

    private saveStations(stations: StationRow[]): void {
        void this.onChange(this.props.attr!, stations);
    }

    private updateStation(index: number, patch: Partial<StationRow>): void {
        const stations = this.getStations().slice();
        stations[index] = { ...stations[index], ...patch };
        this.saveStations(stations);
    }

    private removeStation(index: number): void {
        const stations = this.getStations().slice();
        stations.splice(index, 1);
        this.saveStations(stations);
    }

    private addStation(station?: Partial<StationRow>): void {
        const stations = this.getStations().slice();
        stations.push({ ...emptyStation(), ...station });
        this.saveStations(stations);
        this.setState({ searchResults: [], searchQuery: '' });
    }

    private search = async (): Promise<void> => {
        const pattern = this.state.searchQuery.trim();
        if (!pattern) {
            return;
        }
        if (!this.props.alive) {
            this.setState({
                searchError:
                    'Die Instanz läuft nicht. Bitte Client-Id/Api-Key speichern und die Instanz starten, dann erneut suchen.',
                searchResults: [],
            });
            return;
        }
        this.setState({ searching: true, searchError: '' });
        try {
            const result = await this.props.oContext.socket.sendTo<SearchResult[]>(this.getInstanceId(), 'searchStation', {
                pattern,
            });
            const stations = Array.isArray(result) ? result : [];
            this.setState({
                searchResults: stations,
                searching: false,
                searchError: stations.length ? '' : 'Keine Treffer gefunden.',
            });
        } catch (err) {
            this.setState({
                searching: false,
                searchError: `Suche fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
                searchResults: [],
            });
        }
    };

    renderItem(): React.JSX.Element {
        const stations = this.getStations();

        return (
            <Box sx={{ width: '100%' }}>
                <Typography variant="subtitle1" sx={{ mt: 1 }}>
                    Stationssuche
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1, flexWrap: 'wrap' }}>
                    <TextField
                        size="small"
                        label="Stationsname"
                        value={this.state.searchQuery}
                        onChange={e => this.setState({ searchQuery: e.target.value })}
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                void this.search();
                            }
                        }}
                    />
                    <Button
                        variant="contained"
                        onClick={() => void this.search()}
                        disabled={this.state.searching || !this.state.searchQuery.trim()}
                    >
                        Suchen
                    </Button>
                    {this.state.searching ? <CircularProgress size={20} /> : null}
                </Box>
                {this.state.searchError ? (
                    <Alert severity="warning" sx={{ mb: 1 }}>
                        {this.state.searchError}
                    </Alert>
                ) : null}
                {this.state.searchResults.length ? (
                    <Table size="small" sx={{ mb: 2 }}>
                        <TableBody>
                            {this.state.searchResults.map((r, i) => (
                                <TableRow key={`${r.value}-${i}`}>
                                    <TableCell>{r.label}</TableCell>
                                    <TableCell align="right">
                                        <Button
                                            size="small"
                                            startIcon={<AddIcon />}
                                            onClick={() => {
                                                const nameGuess = r.label.replace(/\s*\([^)]*\)\s*$/, '');
                                                this.addStation({ evaNo: r.value, name: nameGuess || r.value });
                                            }}
                                        >
                                            Hinzufügen
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                ) : null}

                <Typography variant="subtitle1">Stationen</Typography>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Aktiv</TableCell>
                            <TableCell>Name</TableCell>
                            <TableCell>EVA-Nummer</TableCell>
                            <TableCell>Abfahrten</TableCell>
                            <TableCell>Offset (Min.)</TableCell>
                            <TableCell>Kategorie-Filter</TableCell>
                            <TableCell />
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {stations.map((station, index) => (
                            <TableRow key={index}>
                                <TableCell padding="checkbox">
                                    <Checkbox
                                        checked={!!station.active}
                                        onChange={e => this.updateStation(index, { active: e.target.checked })}
                                    />
                                </TableCell>
                                <TableCell>
                                    <TextField
                                        size="small"
                                        variant="standard"
                                        value={station.name || ''}
                                        onChange={e => this.updateStation(index, { name: e.target.value })}
                                    />
                                </TableCell>
                                <TableCell>
                                    <TextField
                                        size="small"
                                        variant="standard"
                                        value={station.evaNo || ''}
                                        onChange={e => this.updateStation(index, { evaNo: e.target.value })}
                                    />
                                </TableCell>
                                <TableCell>
                                    <TextField
                                        size="small"
                                        variant="standard"
                                        type="number"
                                        value={station.count ?? 5}
                                        sx={{ width: 70 }}
                                        onChange={e =>
                                            this.updateStation(index, {
                                                count: Math.max(1, parseInt(e.target.value, 10) || 1),
                                            })
                                        }
                                    />
                                </TableCell>
                                <TableCell>
                                    <TextField
                                        size="small"
                                        variant="standard"
                                        type="number"
                                        value={station.timeOffsetMinutes ?? 0}
                                        sx={{ width: 70 }}
                                        onChange={e =>
                                            this.updateStation(index, {
                                                timeOffsetMinutes: Math.max(0, parseInt(e.target.value, 10) || 0),
                                            })
                                        }
                                    />
                                </TableCell>
                                <TableCell>
                                    <TextField
                                        size="small"
                                        variant="standard"
                                        placeholder="z.B. S,RE,RB"
                                        value={station.categories || ''}
                                        onChange={e => this.updateStation(index, { categories: e.target.value })}
                                    />
                                </TableCell>
                                <TableCell padding="checkbox">
                                    <IconButton size="small" onClick={() => this.removeStation(index)}>
                                        <DeleteIcon fontSize="small" />
                                    </IconButton>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                <Button startIcon={<AddIcon />} onClick={() => this.addStation()} sx={{ mt: 1 }}>
                    Station manuell hinzufügen
                </Button>
            </Box>
        );
    }
}
